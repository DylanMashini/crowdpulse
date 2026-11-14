import { access } from "node:fs/promises";
import { resolve } from "node:path";

import { InferenceSession } from "onnxruntime-node";

import { env } from "../env.ts";
import { ApiError } from "../http.ts";

/** Stored beside every embedding. Embeddings from different models never compare. */
export const FACE_MODEL = "sface-2021dec";

const DETECTOR_FILE = "face_detection_yunet_2023mar.onnx";
const EMBEDDER_FILE = "face_recognition_sface_2021dec.onnx";

export type FaceModels = { detector: InferenceSession; embedder: InferenceSession };

const globalForFace = globalThis as typeof globalThis & { triagecamFaceModels?: Promise<FaceModels> };

async function load(): Promise<FaceModels> {
  const directory = resolve(/*turbopackIgnore: true*/ process.cwd(), env().FACE_MODELS_DIR);
  const paths = [resolve(directory, DETECTOR_FILE), resolve(directory, EMBEDDER_FILE)] as const;
  try {
    await Promise.all(paths.map((path) => access(path)));
  } catch {
    throw new ApiError(
      "face_unavailable",
      "Face match is unavailable on this server because its models are not installed. Choose the patient from the waiting-room list instead.",
    );
  }
  // Severity 3 keeps the runtime's per-model graph warnings out of the server log.
  // KleidiAI's SME convolution kernels in onnxruntime 1.31 die with SIGILL on Apple silicon
  // when a run lands on a thread without streaming mode set up, which takes the whole server
  // with it. The plain MLAS kernels are a few milliseconds slower and do not crash.
  const options = { logSeverityLevel: 3 as const, extra: { mlas: { disable_kleidiai: "1" } } };
  const [detector, embedder] = await Promise.all(paths.map((path) => InferenceSession.create(path, options)));
  return { detector: detector as InferenceSession, embedder: embedder as InferenceSession };
}

/** The two ONNX sessions, loaded on first use. Throws face_unavailable when the files are missing. */
export function faceModels(): Promise<FaceModels> {
  globalForFace.triagecamFaceModels ??= load().catch((error) => {
    globalForFace.triagecamFaceModels = undefined;
    throw error;
  });
  return globalForFace.triagecamFaceModels;
}
