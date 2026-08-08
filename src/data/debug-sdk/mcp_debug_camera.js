(function () {
  "use strict";

  function dotaHud() {
    var panel = $.GetContextPanel();
    while (panel && panel.GetParent()) panel = panel.GetParent();
    return panel;
  }

  function findMinimap() {
    var hud = dotaHud();
    if (!hud) return null;
    var ids = ["minimap", "minimap_block", "MinimapContainer"];
    for (var i = 0; i < ids.length; i++) {
      var panel = hud.FindChildTraverse(ids[i]);
      if (panel) return panel;
    }
    return null;
  }

  function finite(value) {
    value = Number(value);
    return isFinite(value) ? value : 0;
  }

  function bounded(value, minimum, maximum) {
    value = finite(value);
    return Math.max(minimum, Math.min(maximum, value));
  }

  function report(request) {
    var camera = GameUI.GetCameraLookAtPosition();
    var minimap = findMinimap();
    var position = minimap ? minimap.GetPositionWithinWindow() : { x: 0, y: 0 };
    GameEvents.SendCustomGameEventToServer("mcp_camera_report", {
      request_id: String(request.request_id || "unknown"),
      camera_x: finite(camera && camera[0]),
      camera_y: finite(camera && camera[1]),
      camera_z: finite(camera && camera[2]),
      screen_width: finite(Game.GetScreenWidth()),
      screen_height: finite(Game.GetScreenHeight()),
      minimap_id: minimap ? String(minimap.id || "unknown") : "",
      minimap_x: finite(position.x),
      minimap_y: finite(position.y),
      minimap_width: minimap ? finite(minimap.actuallayoutwidth) : 0,
      minimap_height: minimap ? finite(minimap.actuallayoutheight) : 0,
      minimap_scale_x: minimap ? finite(minimap.actualuiscale_x || 1) : 1,
      minimap_scale_y: minimap ? finite(minimap.actualuiscale_y || 1) : 1
    });
  }

  function reportFrame(request, origin, focusPoint) {
    var lookAt = GameUI.GetCameraLookAtPosition();
    var camera = GameUI.GetCameraPosition();
    var screen = GameUI.WorldToScreenXYClamped(focusPoint);
    GameEvents.SendCustomGameEventToServer("mcp_camera_frame_report", {
      request_id: String(request.request_id || "unknown"),
      target_name: String(request.target_name || "unknown"),
      player_id: finite(request.player_id),
      hero_hidden: request.hero_hidden ? 1 : 0,
      origin_x: origin[0],
      origin_y: origin[1],
      origin_z: origin[2],
      focus_x: focusPoint[0],
      focus_y: focusPoint[1],
      focus_z: focusPoint[2],
      look_at_x: finite(lookAt && lookAt[0]),
      look_at_y: finite(lookAt && lookAt[1]),
      look_at_z: finite(lookAt && lookAt[2]),
      camera_x: finite(camera && camera[0]),
      camera_y: finite(camera && camera[1]),
      camera_z: finite(camera && camera[2]),
      screen_u: finite(screen && screen[0]),
      screen_v: finite(screen && screen[1]),
      distance: bounded(request.distance, 400, 5000),
      yaw: bounded(request.yaw, -360, 360),
      pitch: bounded(request.pitch, 20, 89),
      height_offset: bounded(request.height_offset, -2048, 2048)
    });
  }

  function frameTarget(request) {
    var origin = [
      finite(request.origin_x),
      finite(request.origin_y),
      finite(request.origin_z)
    ];
    var distance = bounded(request.distance, 400, 5000);
    var yaw = bounded(request.yaw, -360, 360);
    var pitch = bounded(request.pitch, 20, 89);
    var heightOffset = bounded(request.height_offset, -2048, 2048);
    var focusPoint = [origin[0], origin[1], origin[2] + heightOffset];

    GameUI.SetCameraTarget(-1);
    GameUI.SetCameraTerrainAdjustmentEnabled(false);
    GameUI.SetCameraPitchMin(pitch);
    GameUI.SetCameraPitchMax(pitch);
    GameUI.SetCameraYaw(yaw);
    GameUI.SetCameraDistance(distance);
    GameUI.SetCameraLookAtPositionHeightOffset(heightOffset);
    GameUI.SetCameraTargetPosition(origin, 0.0);

    $.Schedule(0.35, function () {
      reportFrame(request, origin, focusPoint);
    });
  }

  GameEvents.Subscribe("mcp_camera_request", report);
  GameEvents.Subscribe("mcp_camera_frame_request", frameTarget);
  $.Msg("[MCP Camera] telemetry bridge loaded");
})();
