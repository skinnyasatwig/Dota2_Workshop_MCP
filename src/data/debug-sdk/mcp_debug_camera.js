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

  GameEvents.Subscribe("mcp_camera_request", report);
  $.Msg("[MCP Camera] telemetry bridge loaded");
})();
