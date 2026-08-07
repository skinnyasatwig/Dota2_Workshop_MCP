--[[
  MCP DebugSDK  —  an in-game debug/control surface for the Dota 2 Workshop MCP.

  Drop this into a custom game's vscripts and require it once (the MCP's
  `addon_attach_debug_sdk` tool does this for you). It registers a set of console
  commands prefixed `mcp_*` that the MCP drives over the VConsole2 channel to
  inspect and control a running game deterministically — spawn units, grant
  gold/levels/items, dump game state as JSON, evaluate Lua, run assertions for
  self-tests, fire UI events, and prep clean screenshots.

  Every machine-readable line is prefixed with "[MCP]" so the MCP can grep it out
  of the live console stream. Safe to hot-reload (script_reload re-registers).

  This file is the source of truth bundled inside the MCP. Do not edit the copy in
  your addon by hand — re-attach to update.
]]

local SDK_VERSION = "1.4.0"

----------------------------------------------------------------------
-- Tiny JSON encoder (no dependencies; handles the shapes we emit).
----------------------------------------------------------------------
local JSON_ARRAY_MT = {}
local function jsonArray(values)
  return setmetatable(values or {}, JSON_ARRAY_MT)
end

local function jsonEncode(v, seen)
  seen = seen or {}
  local t = type(v)
  if t == "nil" then return "null" end
  if t == "boolean" then return v and "true" or "false" end
  if t == "number" then
    if v ~= v or v == math.huge or v == -math.huge then return "null" end
    return tostring(v)
  end
  if t == "string" then
    return '"' .. v:gsub('[%z\1-\31\\"]', function(c)
      local map = { ['"'] = '\\"', ['\\'] = '\\\\', ['\n'] = '\\n', ['\r'] = '\\r', ['\t'] = '\\t' }
      return map[c] or string.format('\\u%04x', string.byte(c))
    end) .. '"'
  end
  if t == "table" then
    if seen[v] then return '"<cycle>"' end
    seen[v] = true
    -- array?
    local n, isArray = 0, true
    local forcedArray = getmetatable(v) == JSON_ARRAY_MT
    for k, _ in pairs(v) do
      n = n + 1
      if type(k) ~= "number" then isArray = false end
    end
    if n == 0 and not forcedArray then isArray = false end
    local parts = {}
    if isArray then
      for i = 1, #v do parts[#parts + 1] = jsonEncode(v[i], seen) end
      seen[v] = nil
      return "[" .. table.concat(parts, ",") .. "]"
    end
    for k, val in pairs(v) do
      parts[#parts + 1] = jsonEncode(tostring(k), seen) .. ":" .. jsonEncode(val, seen)
    end
    seen[v] = nil
    return "{" .. table.concat(parts, ",") .. "}"
  end
  -- functions, userdata, entities, etc.
  return jsonEncode(tostring(v), seen)
end

local function out(...)
  print("[MCP] " .. table.concat({ ... }, " "))
end

local function joinArgs(args, from)
  local t = {}
  for i = from, #args do t[#t + 1] = tostring(args[i]) end
  return table.concat(t, " ")
end

----------------------------------------------------------------------
-- Game-state helpers.
----------------------------------------------------------------------
local function firstHero()
  if PlayerResource == nil then return nil, nil end
  for pid = 0, 23 do
    if PlayerResource:IsValidPlayerID(pid) then
      local h = PlayerResource:GetSelectedHeroEntity(pid)
      if h and not h:IsNull() then return h, pid end
    end
  end
  return nil, nil
end

local function heroForPid(pid)
  if PlayerResource == nil then return nil, nil end
  if pid == nil then return firstHero() end
  pid = tonumber(pid)
  if pid == nil or not PlayerResource:IsValidPlayerID(pid) then return nil, nil end
  return PlayerResource:GetSelectedHeroEntity(pid), pid
end

local function snapshotState()
  local players = {}
  if PlayerResource ~= nil then
    for pid = 0, 23 do
      if PlayerResource:IsValidPlayerID(pid) then
        local h = PlayerResource:GetSelectedHeroEntity(pid)
        players[#players + 1] = {
          pid = pid,
          team = PlayerResource:GetTeam(pid),
          gold = PlayerResource:GetGold(pid),
          hero = (h and not h:IsNull()) and h:GetUnitName() or nil,
          level = (h and not h:IsNull()) and h:GetLevel() or nil,
          alive = (h and not h:IsNull()) and h:IsAlive() or false,
          hp = (h and not h:IsNull()) and h:GetHealth() or nil,
        }
      end
    end
  end
  local unitCount = 0
  local e = Entities:First()
  while e do
    if e.IsBaseNPC and e:IsBaseNPC() then unitCount = unitCount + 1 end
    e = Entities:Next(e)
  end
  return {
    gameTime = GameRules:GetGameTime(),
    dotaTime = GameRules:GetDOTATime(true, true),
    state = GameRules:State_Get(),
    paused = GameRules:IsGamePaused(),
    players = players,
    unitCount = unitCount,
  }
end

----------------------------------------------------------------------
-- Command implementations.
----------------------------------------------------------------------
local function cmd_ping(_, requestId)
  local version = "v=" .. SDK_VERSION
  local gameTime = "t=" .. string.format("%.2f", GameRules:GetGameTime())
  local state = "state=" .. tostring(GameRules:State_Get())
  if requestId then
    out("PONG", version, gameTime, state, "request=" .. tostring(requestId))
  else
    out("PONG", version, gameTime, state)
  end
end

local function cmd_state()
  out("STATE", jsonEncode(snapshotState()))
end

local function cmd_dump(_, section)
  section = section or "state"
  if section == "state" then
    out("DUMP", "state", jsonEncode(snapshotState()))
  elseif section == "heroes" then
    local heroes = {}
    for _, h in ipairs(HeroList and HeroList:GetAllHeroes() or {}) do
      heroes[#heroes + 1] = { name = h:GetUnitName(), pid = h:GetPlayerOwnerID(), level = h:GetLevel(), hp = h:GetHealth(), maxhp = h:GetMaxHealth(), alive = h:IsAlive(), pos = { h:GetAbsOrigin().x, h:GetAbsOrigin().y, h:GetAbsOrigin().z } }
    end
    out("DUMP", "heroes", jsonEncode(heroes))
  elseif section == "nettables" then
    out("DUMP", "nettables", "use mcp_eval to inspect CustomNetTables:GetAllTableValues(<name>)")
  elseif section == "units" then
    local units, e = {}, Entities:First()
    while e do
      if e.IsBaseNPC and e:IsBaseNPC() and not (e.IsHero and e:IsHero()) then
        units[#units + 1] = { name = e:GetUnitName(), team = e:GetTeamNumber(), hp = e:GetHealth() }
      end
      e = Entities:Next(e)
    end
    out("DUMP", "units", "count=" .. #units, jsonEncode(units))
  else
    out("DUMP_ERR", "unknown section '" .. tostring(section) .. "' (state|heroes|units|nettables)")
  end
end

local loadString = loadstring or load

local function cmd_eval(args)
  local code = joinArgs(args, 2)
  if code == "" then out("EVAL_ERR", "no code"); return end
  -- Try as an expression first (so `mcp_eval GameRules:GetGameTime()` returns a value).
  local fn, err = loadString("return " .. code)
  if not fn then fn, err = loadString(code) end
  if not fn then out("EVAL_ERR", tostring(err)); return end
  local ok, res = pcall(fn)
  if not ok then out("EVAL_ERR", tostring(res)); return end
  out("EVAL_OK", jsonEncode(res))
end

-- Compact real-engine path query. Keeping the GridNav program inside the SDK
-- avoids Source 2's short console-command limit; callers send only coordinates.
-- Usage: mcp_nav <request-id> <route-name> <endpoints|segments|both> x,y,z:x,y,z
local function cmd_nav(_, requestId, routeName, mode, encodedPoints)
  requestId = tostring(requestId or "unknown")
  if not routeName or not mode or not encodedPoints then
    out("NAV_ERR", requestId, "usage: mcp_nav <request-id> <route-name> <endpoints|segments|both> x,y,z:x,y,z")
    return
  end
  if mode ~= "endpoints" and mode ~= "segments" and mode ~= "both" then
    out("NAV_ERR", requestId, "invalid mode '" .. tostring(mode) .. "'")
    return
  end

  local points = {}
  for encodedPoint in string.gmatch(encodedPoints, "[^:]+") do
    local sx, sy, sz = string.match(encodedPoint, "^([^,]+),([^,]+),([^,]+)$")
    local x, y, z = tonumber(sx), tonumber(sy), tonumber(sz)
    if not x or not y or not z then
      out("NAV_ERR", requestId, "invalid point '" .. tostring(encodedPoint) .. "'")
      return
    end
    points[#points + 1] = Vector(x, y, z)
  end
  if #points < 2 then
    out("NAV_ERR", requestId, "at least two points are required")
    return
  end

  local ok, result = pcall(function()
    local function nearestReachable(point, anchor)
      local gridX = GridNav:WorldToGridPosX(point.x)
      local gridY = GridNav:WorldToGridPosY(point.y)
      for radius = 1, 8 do
        local best = nil
        for dx = -radius, radius do
          for dy = -radius, radius do
            if math.abs(dx) == radius or math.abs(dy) == radius then
              local candidate = Vector(
                GridNav:GridPosToWorldCenterX(gridX + dx),
                GridNav:GridPosToWorldCenterY(gridY + dy),
                point.z
              )
              if GridNav:IsTraversable(candidate) and GridNav:CanFindPath(candidate, anchor) then
                local distance = math.sqrt((candidate.x - point.x) ^ 2 + (candidate.y - point.y) ^ 2)
                if not best or distance < best.distance then
                  best = {
                    point = { candidate.x, candidate.y, candidate.z },
                    gridOffset = { dx, dy },
                    distance = distance,
                  }
                end
              end
            end
          end
        end
        if best then return best end
      end
      return nil
    end

    local function check(a, b, index)
      local canFindPath = GridNav:CanFindPath(a, b)
      local pathLength = GridNav:FindPathLength(a, b)
      local startTraversable = GridNav:IsTraversable(a)
      local endTraversable = GridNav:IsTraversable(b)
      return {
        index = index,
        from = { a.x, a.y, a.z },
        to = { b.x, b.y, b.z },
        startTraversable = startTraversable,
        endTraversable = endTraversable,
        canFindPath = canFindPath,
        pathLength = pathLength,
        passed = canFindPath and startTraversable and endTraversable and pathLength >= 0,
        -- A point can be individually traversable while isolated by an
        -- obstruction. Search around disconnected endpoints too, so callers
        -- receive a useful repair for sealed gates and cut-off regions.
        nearestStart = (not startTraversable or not canFindPath) and nearestReachable(a, b) or nil,
        nearestEnd = (not endTraversable or not canFindPath) and nearestReachable(b, a) or nil,
      }
    end

    local endpoint = nil
    local segments = jsonArray()
    local passed = true
    if mode ~= "segments" then
      endpoint = check(points[1], points[#points], nil)
      if not endpoint.passed then passed = false end
    end
    if mode ~= "endpoints" then
      for i = 1, #points - 1 do
        local row = check(points[i], points[i + 1], i)
        segments[#segments + 1] = row
        if not row.passed then passed = false end
      end
    end
    return {
      name = routeName,
      mode = mode,
      pointCount = #points,
      endpoint = endpoint,
      segments = segments,
      passed = passed,
    }
  end)

  if not ok then
    out("NAV_ERR", requestId, tostring(result))
    return
  end
  out("NAV_OK", requestId, jsonEncode(result))
end

local function cmd_assert(args)
  local code = joinArgs(args, 2)
  if code == "" then out("ASSERT", "FAIL", "(no expression)"); return end
  local fn, err = loadString("return (" .. code .. ")")
  if not fn then out("ASSERT", "FAIL", "compile: " .. tostring(err), "::", code); return end
  local ok, res = pcall(fn)
  if not ok then out("ASSERT", "FAIL", "error: " .. tostring(res), "::", code); return end
  if res then out("ASSERT", "PASS", "::", code) else out("ASSERT", "FAIL", "falsy: " .. tostring(res), "::", code) end
end

local function cmd_spawn(_, unit, count, team)
  if not unit then out("SPAWN_ERR", "usage: mcp_spawn <unitname> [count] [team]"); return end
  count = tonumber(count) or 1
  local hero = firstHero()
  local origin = hero and hero:GetAbsOrigin() or Vector(0, 0, 0)
  local teamNum = tonumber(team) or DOTA_TEAM_BADGUYS
  local made = 0
  for i = 1, count do
    local pos = origin + RandomVector(RandomFloat(64, 256))
    local u = CreateUnitByName(unit, pos, true, nil, nil, teamNum)
    if u and not u:IsNull() then made = made + 1 end
  end
  out("SPAWN", unit, "x" .. made, "team=" .. teamNum)
end

local function cmd_gold(_, amount, pid)
  local hero, p = heroForPid(pid)
  amount = tonumber(amount) or 0
  if p == nil then out("GOLD_ERR", "no valid player"); return end
  PlayerResource:ModifyGold(p, amount, true, 0)
  out("GOLD", "pid=" .. p, "+" .. amount, "now=" .. PlayerResource:GetGold(p))
end

local function cmd_level(_, level, pid)
  local hero, p = heroForPid(pid)
  level = tonumber(level)
  if not hero or hero:IsNull() then out("LEVEL_ERR", "no hero"); return end
  if not level then out("LEVEL_ERR", "usage: mcp_level <level> [pid]"); return end
  local guard = 0
  while hero:GetLevel() < level and guard < 200 do hero:HeroLevelUp(false); guard = guard + 1 end
  out("LEVEL", "pid=" .. tostring(p), "now=" .. hero:GetLevel())
end

local function cmd_item(_, item, pid)
  local hero, p = heroForPid(pid)
  if not item then out("ITEM_ERR", "usage: mcp_item <item_name> [pid]"); return end
  if not hero or hero:IsNull() then out("ITEM_ERR", "no hero"); return end
  local it = CreateItem(item, hero, hero)
  if not it then out("ITEM_ERR", "could not create '" .. item .. "'"); return end
  hero:AddItem(it)
  out("ITEM", item, "-> pid=" .. tostring(p))
end

local function cmd_event(args)
  local name = args[2]
  if not name then out("EVENT_ERR", "usage: mcp_event <event_name> [json-data]"); return end
  local payload = joinArgs(args, 3)
  local data = {}
  if payload ~= "" then
    local fn = loadString("return " .. payload)
    if fn then local ok, t = pcall(fn); if ok and type(t) == "table" then data = t end end
  end
  CustomGameEventManager:Send_ServerToAllClients(name, data)
  out("EVENT", name, jsonEncode(data))
end

local function firstPlayer()
  if PlayerResource == nil then return nil, nil end
  for pid = 0, 23 do
    if PlayerResource:IsValidPlayerID(pid) then
      local player = PlayerResource:GetPlayer(pid)
      if player then return player, pid end
    end
  end
  return nil, nil
end

-- Ask the optional Panorama bridge for the local camera and minimap geometry.
-- Usage: mcp_camera <request-id> [player-id]
local function cmd_camera(_, requestId, requestedPid)
  requestId = tostring(requestId or "")
  if requestId == "" or not string.match(requestId, "^[A-Za-z0-9_.:-]+$") then
    out("CAMERA_ERR", requestId ~= "" and requestId or "unknown", "invalid or missing request id")
    return
  end
  local player, pid
  if requestedPid ~= nil then
    pid = tonumber(requestedPid)
    if pid ~= nil and PlayerResource and PlayerResource:IsValidPlayerID(pid) then
      player = PlayerResource:GetPlayer(pid)
    end
  else
    player, pid = firstPlayer()
  end
  if not player then
    out("CAMERA_ERR", requestId, "no connected player")
    return
  end
  CustomGameEventManager:Send_ServerToPlayer(player, "mcp_camera_request", { request_id = requestId })
  out("CAMERA_SENT", requestId, "pid=" .. tostring(pid))
end

if CustomGameEventManager and not _G.__MCP_CAMERA_REPORT_LISTENER then
  _G.__MCP_CAMERA_REPORT_LISTENER = CustomGameEventManager:RegisterListener("mcp_camera_report", function(_, payload)
    local requestId = tostring(payload and payload.request_id or "unknown")
    local response = {
      camera = {
        x = tonumber(payload and payload.camera_x),
        y = tonumber(payload and payload.camera_y),
        z = tonumber(payload and payload.camera_z),
      },
      screen = {
        width = tonumber(payload and payload.screen_width),
        height = tonumber(payload and payload.screen_height),
      },
      minimap = {
        id = payload and payload.minimap_id or nil,
        x = tonumber(payload and payload.minimap_x),
        y = tonumber(payload and payload.minimap_y),
        width = tonumber(payload and payload.minimap_width),
        height = tonumber(payload and payload.minimap_height),
        uiScaleX = tonumber(payload and payload.minimap_scale_x),
        uiScaleY = tonumber(payload and payload.minimap_scale_y),
      },
    }
    out("CAMERA_OK", requestId, jsonEncode(response))
  end)
end

local function cmd_hud(_, on)
  -- Toggle HUD/cursor for clean screenshots (client-side conveniences via convars).
  local v = (tostring(on) == "0") and 0 or 1
  SendToServerConsole("dota_hud_visible " .. v)
  out("HUD", tostring(v))
end

local function cmd_pause(_, on)
  local p = (tostring(on) == "0") and false or true
  PauseGame(p)
  out("PAUSE", tostring(p))
end

----------------------------------------------------------------------
-- Registration (idempotent across script_reload).
----------------------------------------------------------------------
local function reg(name, fn, help)
  -- Wrap so a thrown error never kills the console command.
  local ok = pcall(function()
    Convars:RegisterCommand(name, function(...) local a = { ... }; local ok2, e = pcall(fn, a, a[2], a[3], a[4], a[5]); if not ok2 then out(name .. "_ERR", tostring(e)) end end, help or name, 0)
  end)
  return ok
end

reg("mcp_ping", cmd_ping, "MCP: health check (optional request id is echoed)")
reg("mcp_state", function() cmd_state() end, "MCP: dump high-level game state as JSON")
reg("mcp_dump", cmd_dump, "MCP: dump a section (state|heroes|units|nettables) as JSON")
reg("mcp_eval", cmd_eval, "MCP: eval Lua and print the JSON-encoded result")
reg("mcp_nav", cmd_nav, "MCP: run a compact, correlated GridNav route query")
reg("mcp_assert", cmd_assert, "MCP: evaluate a boolean Lua expression; prints PASS/FAIL")
reg("mcp_spawn", cmd_spawn, "MCP: spawn units near a hero (mcp_spawn <unit> [count] [team])")
reg("mcp_gold", cmd_gold, "MCP: grant gold (mcp_gold <amount> [pid])")
reg("mcp_level", cmd_level, "MCP: level a hero up to N (mcp_level <level> [pid])")
reg("mcp_item", cmd_item, "MCP: give an item (mcp_item <item> [pid])")
reg("mcp_event", cmd_event, "MCP: fire a custom game event to clients (mcp_event <name> [json])")
reg("mcp_camera", cmd_camera, "MCP: query local camera/minimap geometry through the optional Panorama bridge")
reg("mcp_hud", cmd_hud, "MCP: toggle HUD visibility (mcp_hud <0|1>) for clean shots")
reg("mcp_pause", cmd_pause, "MCP: pause/unpause (mcp_pause <0|1>)")

out("DebugSDK", "loaded", "v=" .. SDK_VERSION, "(commands: mcp_ping mcp_state mcp_dump mcp_eval mcp_nav mcp_assert mcp_spawn mcp_gold mcp_level mcp_item mcp_event mcp_camera mcp_hud mcp_pause)")

return { version = SDK_VERSION }
