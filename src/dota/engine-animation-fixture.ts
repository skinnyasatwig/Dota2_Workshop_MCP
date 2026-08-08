// Repository-owned animated-prop fixture layered onto Valve's valid blank map.
// One large client-animated banner is the renderer target. A second, ordinary-size
// copy opts into server animation only inside this disposable fixture so GetCycle()
// can independently prove that the checked sequence advances in the real engine.

import { animatedPropRecipe } from "./animated-prop-recipes.js";
import type { EngineFrameSettings } from "./engine-animation-test.js";
import { parseMapEntities, reconcileMapEntities } from "./vmap.js";

export const ENGINE_ANIMATION_FIXTURE_MAP = "mcp_animation_fixture";
export const ENGINE_ANIMATION_FIXTURE_DEBUG_SDK_VERSION = "1.7.0";
export const ENGINE_ANIMATION_CLIENT_TARGET = "fixture_banner_client";
export const ENGINE_ANIMATION_SERVER_TARGET = "fixture_banner_server_probe";
export const ENGINE_ANIMATION_FOCUS_TARGET = "fixture_banner_camera_anchor";
export const ENGINE_ANIMATION_MODEL = "models/props_teams/banner_dire.vmdl";
export const ENGINE_ANIMATION_SEQUENCE = "banner_dire_idle";
export const ENGINE_ANIMATION_FRAME_REGION = {
  x: 0.3,
  y: 0.08,
  width: 0.4,
  height: 0.7,
} as const;
export const ENGINE_ANIMATION_FRAME_SETTINGS: EngineFrameSettings = {
  distance: 1600,
  yaw: 90,
  pitch: 60,
  // Dire's CRC-checked bounds center is about 264.9 local Z; the fixture's
  // 2x scale puts that center about 530 units above its entity origin.
  heightOffset: 530,
  hideHero: true,
};

function bannerProperties(animateOnServer: boolean): Record<string, string> {
  const recipe = animatedPropRecipe("dire-team-banner");
  return {
    model: recipe.model,
    solid: "0",
    spawnflags: "512",
    CreateNavObstacle: "0",
    use_animgraph: "0",
    StartingAnim: ENGINE_ANIMATION_SEQUENCE,
    StartingAnimationLoopMode: "ANIM_LOOP_MODE_USE_SEQUENCE_SETTINGS",
    IdleAnim: ENGINE_ANIMATION_SEQUENCE,
    AnimationLoopMode: "ANIM_LOOP_MODE_USE_SEQUENCE_SETTINGS",
    randomizecycle: "0",
    AnimateOnServer: animateOnServer ? "1" : "0",
    disableshadows: "1",
  };
}

/** Apply only two named props; the installed template retains its ground, lights, and player starts. */
export function buildEngineAnimationFixtureText(baseText: string): string {
  return reconcileMapEntities(baseText, [
    {
      targetname: ENGINE_ANIMATION_CLIENT_TARGET,
      classname: "prop_dynamic",
      origin: "0 350 142",
      angles: "0 90 0",
      scales: "2 2 2",
      properties: bannerProperties(false),
    },
    {
      targetname: ENGINE_ANIMATION_SERVER_TARGET,
      classname: "prop_dynamic",
      origin: "1400 700 142",
      angles: "0 0 0",
      scales: "1 1 1",
      properties: bannerProperties(true),
    },
    {
      targetname: ENGINE_ANIMATION_FOCUS_TARGET,
      classname: "info_target",
      origin: "0 350 0",
      angles: "0 0 0",
    },
  ]).text;
}

export interface EngineAnimationFixtureInspection {
  client?: ReturnType<typeof parseMapEntities>[number];
  server?: ReturnType<typeof parseMapEntities>[number];
  focus?: ReturnType<typeof parseMapEntities>[number];
  issues: string[];
  passed: boolean;
}

/** Fail closed if conversion changed the checked model, sequence, or safety properties. */
export function inspectEngineAnimationFixture(text: string): EngineAnimationFixtureInspection {
  const entities = parseMapEntities(text);
  const client = entities.find((entity) => entity.targetname === ENGINE_ANIMATION_CLIENT_TARGET);
  const server = entities.find((entity) => entity.targetname === ENGINE_ANIMATION_SERVER_TARGET);
  const focus = entities.find((entity) => entity.targetname === ENGINE_ANIMATION_FOCUS_TARGET);
  const issues: string[] = [];
  const check = (label: string, entity: typeof client, expectedServerAnimation: string) => {
    if (!entity) {
      issues.push(`${label} banner is missing.`);
      return;
    }
    if (entity.classname !== "prop_dynamic") issues.push(`${label} is ${entity.classname}, not prop_dynamic.`);
    if (entity.properties.model !== ENGINE_ANIMATION_MODEL) issues.push(`${label} has the wrong model.`);
    if (entity.properties.StartingAnim !== ENGINE_ANIMATION_SEQUENCE ||
        entity.properties.IdleAnim !== ENGINE_ANIMATION_SEQUENCE) {
      issues.push(`${label} has the wrong checked sequence.`);
    }
    if (entity.properties.StartingAnimationLoopMode !== "ANIM_LOOP_MODE_USE_SEQUENCE_SETTINGS" ||
        entity.properties.AnimationLoopMode !== "ANIM_LOOP_MODE_USE_SEQUENCE_SETTINGS") {
      issues.push(`${label} does not use the sequence's proven loop settings.`);
    }
    if (entity.properties.solid !== "0" || entity.properties.spawnflags !== "512" ||
        entity.properties.CreateNavObstacle !== "0") {
      issues.push(`${label} is not collision- and navigation-neutral.`);
    }
    if (entity.properties.AnimateOnServer !== expectedServerAnimation) {
      issues.push(`${label} has AnimateOnServer=${entity.properties.AnimateOnServer}; expected ${expectedServerAnimation}.`);
    }
  };
  check("Client renderer target", client, "0");
  check("Server cycle probe", server, "1");
  if (client?.scales !== "2 2 2") issues.push("Client renderer target lost its intentional 2x fixture scale.");
  if (!focus || focus.classname !== "info_target" || focus.origin !== "0 350 0") {
    issues.push("The renderer camera anchor is missing or changed.");
  }
  return { client, server, focus, issues, passed: issues.length === 0 };
}
