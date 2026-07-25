import { test, expect } from "@playwright/test";

// A track that fails to save is the cruellest failure this app has: it is in the
// list, it is playing, and it is gone on the next reload. It used to be swallowed by
// an empty catch. These make sure the person is told, and told which kind of gone.

function tinyWavBuffer() {
  const rate = 8000, n = 2400;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8); buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 6000), 44 + i * 2);
  return buf;
}

const addATrack = (page) => page.setInputFiles("#filepick", {
  name: "t.wav", mimeType: "audio/wav", buffer: tinyWavBuffer(),
});

test("a track that runs out of room says so instead of vanishing quietly", async ({ page }) => {
  // make every write fail the way a full device does, before the app loads
  await page.addInitScript(() => {
    const realOpen = indexedDB.open.bind(indexedDB);
    indexedDB.open = (...args) => {
      const req = realOpen(...args);
      req.addEventListener("success", () => {
        const db = req.result;
        const realTx = db.transaction.bind(db);
        db.transaction = (...targs) => {
          const tx = realTx(...targs);
          const realStore = tx.objectStore.bind(tx);
          tx.objectStore = (name) => {
            const store = realStore(name);
            const realPut = store.put.bind(store);
            store.put = (...pargs) => {
              const r = realPut(...pargs);
              setTimeout(() => {
                Object.defineProperty(r, "error", { value: new DOMException("full", "QuotaExceededError") });
                r.dispatchEvent(new Event("error"));
              }, 0);
              return r;
            };
            return store;
          };
          return tx;
        };
      });
      return req;
    };
  });

  await page.goto("/");
  await page.locator("#dialMid").click();
  await addATrack(page);
  await expect(page.locator("#trackList .track-row")).toHaveCount(1);

  await expect(page.locator("#recordOut")).toContainText(/存储空间不够|Not enough room/, { timeout: 10_000 });
});

test("a browser that refuses storage entirely is called out", async ({ page }) => {
  // private browsing, roughly: opening the database simply fails
  await page.addInitScript(() => {
    indexedDB.open = () => {
      const req = { onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null, error: new DOMException("denied", "InvalidStateError") };
      setTimeout(() => req.onerror && req.onerror(), 0);
      return req;
    };
  });

  await page.goto("/");
  await page.locator("#dialMid").click();
  await addATrack(page);
  await expect(page.locator("#trackList .track-row")).toHaveCount(1);

  // listening and sharing still work; only persistence is gone, and it says so
  await expect(page.locator("#recordOut")).toContainText(/不让本站存东西|will not let the site store/, { timeout: 10_000 });
});

test("tracks really do survive a reload when storage works", async ({ page }) => {
  await page.goto("/");
  await page.locator("#dialMid").click();
  await page.locator("#chNameInput").fill("Persist test");
  await addATrack(page);
  await expect(page.locator("#trackList .track-row")).toHaveCount(1);
  await page.locator("#stationSave").click();

  await page.reload();
  await page.locator("#dialMid").click();
  await expect(page.locator("#trackList .track-row")).toHaveCount(1);
  await expect(page.locator("#recordOut")).toBeHidden();
});
