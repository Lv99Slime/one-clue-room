import assert from "node:assert/strict";
import { findDuplicateClueKeys, normalizeClue, scoreLabel } from "../src/shared/game.js";

const tests: Array<[string, () => void]> = [
  [
    "normalizes clues for duplicate matching",
    () => {
      assert.equal(normalizeClue("  HELLO! "), "hello");
      assert.equal(normalizeClue("ＡＩ  教學"), "ai教學");
    }
  ],
  [
    "finds duplicate clue keys after normalization",
    () => {
      const duplicates = findDuplicateClueKeys([{ text: "Bus" }, { text: "bus!" }, { text: "train" }]);
      assert.equal(duplicates.has("bus"), true);
      assert.equal(duplicates.has("train"), false);
    }
  ],
  [
    "labels final scores",
    () => {
      assert.match(scoreLabel(13, 13), /Perfect/);
      assert.match(scoreLabel(0, 13), /eventually/);
    }
  ]
];

for (const [name, run] of tests) {
  run();
  console.log(`ok - ${name}`);
}
