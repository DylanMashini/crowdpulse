// Downloads the two ONNX models the server uses for face match into FACE_MODELS_DIR
// (default apps/web/.models, git-ignored). About 37 MB in total. Run with `pnpm face:models`.
//
//   YuNet  (face_detection_yunet_2023mar.onnx)   face and five landmarks   MIT licence
//   SFace  (face_recognition_sface_2021dec.onnx) 128-number face embedding Apache-2.0 licence
//
// Both come from the OpenCV model zoo: https://github.com/opencv/opencv_zoo
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const ZOO = "https://github.com/opencv/opencv_zoo/raw/main/models";
const MODELS = [
  {
    file: "face_detection_yunet_2023mar.onnx",
    url: `${ZOO}/face_detection_yunet/face_detection_yunet_2023mar.onnx`,
    sha256: "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
  },
  {
    file: "face_recognition_sface_2021dec.onnx",
    url: `${ZOO}/face_recognition_sface/face_recognition_sface_2021dec.onnx`,
    sha256: "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
  },
];

const directory = resolve(import.meta.dirname, "..", process.env.FACE_MODELS_DIR || ".models");
await mkdir(directory, { recursive: true });

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

for (const model of MODELS) {
  const path = resolve(directory, model.file);
  const existing = await readFile(path).catch(() => null);
  if (existing && digest(existing) === model.sha256) {
    console.log(`${model.file}: already present`);
    continue;
  }
  const response = await fetch(model.url);
  if (!response.ok) throw new Error(`${model.file}: download failed with HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = digest(bytes);
  if (actual !== model.sha256) {
    throw new Error(`${model.file}: checksum mismatch (got ${actual}). Nothing was written.`);
  }
  await writeFile(`${path}.part`, bytes);
  await rename(`${path}.part`, path);
  console.log(`${model.file}: downloaded ${(bytes.length / 1e6).toFixed(1)} MB`);
}
