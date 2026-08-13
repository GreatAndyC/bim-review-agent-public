#!/usr/bin/env node

/**
 * Generate the recruitment film's Mandarin narration and instrumental bed with
 * MiniMax, then write the audio_meta.json manifest consumed by assemble-index.
 *
 * Authentication is intentionally environment-only. Never put a MiniMax key in
 * this repository, a command-line argument, or a generated manifest.
 *
 * Usage:
 *   MINIMAX_API_KEY=... node scripts/minimax-audio.mjs --dry-run
 *   MINIMAX_API_KEY=... node scripts/minimax-audio.mjs
 *   MINIMAX_API_KEY=... node scripts/minimax-audio.mjs --voice-only
 *   MINIMAX_API_KEY=... node scripts/minimax-audio.mjs --music-only
 *
 * The script uses the official HTTP endpoints directly so the workflow remains
 * reproducible even when the optional mmx CLI is not installed.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SUBTITLE_META_PATH = join(PROJECT_ROOT, "subtitle_meta.json");
const STORYBOARD_PATH = join(PROJECT_ROOT, "STORYBOARD.md");
const AUDIO_META_PATH = join(PROJECT_ROOT, "audio_meta.json");
const OUTPUT_DIR = join(PROJECT_ROOT, "assets", "audio", "minimax");

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const voiceOnly = args.has("--voice-only");
const musicOnly = args.has("--music-only");
const force = args.has("--force");
const runVoice = !musicOnly;
const runMusic = !voiceOnly;

const apiKey = process.env.MINIMAX_API_KEY?.trim();
const apiHost = (process.env.MINIMAX_API_HOST || "https://api.minimax.io").replace(/\/+$/, "");
const ttsModel = process.env.MINIMAX_TTS_MODEL || "speech-2.8-hd";
const musicModel = process.env.MINIMAX_MUSIC_MODEL || "music-3.0-free";
const voiceId = process.env.MINIMAX_VOICE_ID || "Chinese (Mandarin)_Reliable_Executive";
const voiceSpeed = Number(process.env.MINIMAX_VOICE_SPEED || "1.08");

if (!Number.isFinite(voiceSpeed) || voiceSpeed <= 0) {
  throw new Error("MINIMAX_VOICE_SPEED must be a positive number");
}

const MUSIC_PROMPT =
  "Light upbeat technology instrumental for a precise BIM review product walkthrough; " +
  "bright soft plucked synth, gentle piano stabs, a clean restrained electronic pulse, " +
  "subtle forward motion and curious energy, modern engineering atmosphere, no vocals, no lyrics, " +
  "no dramatic trailer hit, no distracting lead melody, suitable underneath clear Mandarin narration.";

function die(message) {
  console.error(`MiniMax audio: ${message}`);
  process.exitCode = 1;
}

function parseStoryboardDurations(markdown) {
  const durations = new Map();
  const blocks = markdown.split(/^## Frame /m).slice(1);
  for (const block of blocks) {
    const number = Number(block.match(/^(\d+)/)?.[1]);
    const seconds = Number(block.match(/^- duration: ([\d.]+)s/m)?.[1]);
    if (Number.isFinite(number) && Number.isFinite(seconds)) durations.set(number, seconds);
  }
  return durations;
}

function loadPlan() {
  const subtitleMeta = JSON.parse(readFileSync(SUBTITLE_META_PATH, "utf8"));
  const durations = parseStoryboardDurations(readFileSync(STORYBOARD_PATH, "utf8"));
  const frames = (subtitleMeta.voices || []).map((frame) => {
    const words = frame.words || [];
    const pauses = words.slice(0, -1).map((word, index) => {
      const next = words[index + 1];
      const gap = Math.max(0.16, Number(next.start) - Number(word.end));
      return Number(gap.toFixed(2));
    });
    const speechText = words
      .map((word, index) => `${word.text}${index < words.length - 1 ? `<#${pauses[index]}#>` : ""}`)
      .join("");
    return {
      frame: Number(frame.frame),
      duration: durations.get(Number(frame.frame)),
      words,
      speechText,
    };
  });
  if (!frames.length) throw new Error("subtitle_meta.json has no voice cue frames");
  for (const frame of frames) {
    if (!Number.isFinite(frame.duration)) throw new Error(`missing storyboard duration for frame ${frame.frame}`);
    if (!frame.speechText) throw new Error(`empty voice cue for frame ${frame.frame}`);
  }
  return { frames, subtitleMeta };
}

function decodeHexAudio(hex, label) {
  if (typeof hex !== "string" || hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
    throw new Error(`${label} response did not contain valid hex audio`);
  }
  return Buffer.from(hex, "hex");
}

async function requestJson(path, payload) {
  if (!apiKey) throw new Error("MINIMAX_API_KEY is not set; inject it into the current terminal environment first");
  const response = await fetch(`${apiHost}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(`MiniMax ${path} returned HTTP ${response.status} with a non-JSON body`);
  }
  const providerCode = body?.base_resp?.status_code;
  if (!response.ok || (providerCode != null && providerCode !== 0)) {
    const providerMessage = body?.base_resp?.status_msg || "provider error";
    throw new Error(`MiniMax ${path} failed (HTTP ${response.status}): ${providerMessage}`);
  }
  return body;
}

function probeDuration(file) {
  const result = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file],
    { encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(`ffprobe could not read ${file}`);
  const duration = Number(result.stdout.trim());
  if (!Number.isFinite(duration)) throw new Error(`ffprobe returned no duration for ${file}`);
  return duration;
}

function readExistingManifest() {
  if (!existsSync(AUDIO_META_PATH)) return { bgm: null, voices: [], sfx: [] };
  return JSON.parse(readFileSync(AUDIO_META_PATH, "utf8"));
}

async function generateVoice(frame) {
  const outputPath = join(OUTPUT_DIR, `voice-${String(frame.frame).padStart(2, "0")}.mp3`);
  if (existsSync(outputPath) && !force) {
    const duration = probeDuration(outputPath);
    console.log(`voice frame ${frame.frame}: reuse ${duration.toFixed(2)}s`);
    return { frame: frame.frame, path: `assets/audio/minimax/voice-${String(frame.frame).padStart(2, "0")}.mp3`, duration_s: duration };
  }
  const body = await requestJson("/v1/t2a_v2", {
    model: ttsModel,
    text: frame.speechText,
    stream: false,
    language_boost: "Chinese",
    output_format: "hex",
    voice_setting: {
      voice_id: voiceId,
      speed: voiceSpeed,
      vol: 1,
      pitch: 0,
    },
    audio_setting: {
      sample_rate: 32000,
      bitrate: 128000,
      format: "mp3",
      channel: 1,
    },
  });
  const audio = decodeHexAudio(body?.data?.audio, `voice frame ${frame.frame}`);
  writeFileSync(outputPath, audio);
  const duration = probeDuration(outputPath);
  if (duration > frame.duration + 0.35) {
    throw new Error(`voice frame ${frame.frame} is ${duration.toFixed(2)}s but the visual frame is only ${frame.duration}s`);
  }
  console.log(`voice frame ${frame.frame}: generated ${duration.toFixed(2)}s`);
  return { frame: frame.frame, path: `assets/audio/minimax/voice-${String(frame.frame).padStart(2, "0")}.mp3`, duration_s: duration };
}

async function generateMusic() {
  const outputPath = join(OUTPUT_DIR, "bgm-instrumental.mp3");
  if (existsSync(outputPath) && !force) {
    const duration = probeDuration(outputPath);
    console.log(`bgm: reuse ${duration.toFixed(2)}s`);
    return { path: "assets/audio/minimax/bgm-instrumental.mp3", duration_s: duration };
  }
  const body = await requestJson("/v1/music_generation", {
    model: musicModel,
    prompt: MUSIC_PROMPT,
    is_instrumental: true,
    stream: false,
    output_format: "hex",
    audio_setting: {
      sample_rate: 44100,
      bitrate: 256000,
      format: "mp3",
    },
  });
  const audio = decodeHexAudio(body?.data?.audio, "instrumental BGM");
  writeFileSync(outputPath, audio);
  const duration = probeDuration(outputPath);
  console.log(`bgm: generated ${duration.toFixed(2)}s (${musicModel})`);
  return { path: "assets/audio/minimax/bgm-instrumental.mp3", duration_s: duration };
}

function printPlan(plan) {
  console.log(`MiniMax host: ${apiHost}`);
  console.log(`TTS: ${ttsModel} · ${voiceId} · speed ${voiceSpeed}`);
  console.log(`Music: ${musicModel} · instrumental · output 44.1 kHz / 256 kbps MP3`);
  console.log(`Voice frames: ${plan.frames.length} · target film duration: ${[...parseStoryboardDurations(readFileSync(STORYBOARD_PATH, "utf8")).values()].reduce((a, b) => a + b, 0)}s`);
  console.log(`BGM prompt: ${MUSIC_PROMPT}`);
  if (dryRun) console.log("Dry run: no network request and no file was written.");
}

async function main() {
  const plan = loadPlan();
  printPlan(plan);
  if (dryRun) return;
  if (!apiKey) throw new Error("MINIMAX_API_KEY is not set; dry-run is available without credentials");
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const existing = readExistingManifest();
  const voices = [];
  if (runVoice) {
    // Keep requests sequential: this is a small deliverable, and sequential
    // generation avoids surprising rate-limit bursts or duplicate paid calls.
    for (const frame of plan.frames) voices.push(await generateVoice(frame));
  } else {
    voices.push(...(existing.voices || []));
  }
  const bgm = runMusic ? await generateMusic() : existing.bgm;
  if (runMusic && !bgm?.path) throw new Error("BGM generation returned no audio path");

  const manifest = {
    bgm: bgm ? { path: bgm.path, volume: 0.1 } : null,
    bgm_pending: false,
    voices,
    sfx: [],
    provider: {
      name: "minimax",
      tts_model: ttsModel,
      voice_id: voiceId,
      music_model: musicModel,
      music_prompt: MUSIC_PROMPT,
      generated_at: new Date().toISOString(),
      note: "Generated locally; audio files are ignored from the public repository.",
    },
  };
  writeFileSync(AUDIO_META_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${AUDIO_META_PATH}`);
  console.log("Next: run assemble-index.mjs, then HyperFrames check/snapshot/render.");
}

main().catch((error) => die(error.message));
