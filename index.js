/******************** SHARED ********************/
import ENV from "dotenv";
import COLORS from "colors";

ENV.config();
/******************** SHARED ********************/

/******************** UTILS ********************/
import STEALTH from "puppeteer-extra-plugin-stealth";
import PUPPETEER from "puppeteer-extra";
import { Cluster } from "puppeteer-cluster";

PUPPETEER.use(STEALTH());

const launch = async () => {
  let cluster = await Cluster.launch({
    concurrency: Cluster.CONCURRENCY_PAGE,
    maxConcurrency: Number(process.env.MAX_C) || 1,
    timeout: 60000,
    puppeteerOptions: {
      headless: "shell",
      ignoreHTTPSErrors: true,
      executablePath:
        process.env.NODE_ENV === "production"
          ? process.env.PUPPETEER_EXECUTABLE_PATH
          : PUPPETEER.executablePath(),
      args: [
        "--disable-gpu",
        "--disable-canvas-aa",
        "--disable-2d-canvas-clip-aa",
        "--disable-gl-drawing-for-tests",
        "--disable-cache",
        "--disable-software-rasterizer",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-extensions",
        "--disable-dev-shm-usage",
        "--disable-background-networking",
        "--disable-default-apps",
        "--disable-sync",
        "--disable-translate",
        "--disable-application-cache",
        "--disable-offline-load-stale-cache",
        "--disable-gpu-shader-disk-cache",
        "--enable-webgl",
        "--enable-accelerated-2d-canvas",
        "--aggressive-cache-discard",
        "--use-gl=swiftshader",
        "--media-cache-size=0",
        "--disk-cache-size=0",
        "--no-sandbox",
      ],
    },
  });

  console.log(`\n${COLORS.yellow.underline("CLUSTER LAUNCHED")}\n`);

  return cluster;
};

const extract = ({
  extractor,
  embedUrl,
  sourceTarget,
  subTarget,
  referer,
  timeout = 9000,
}) => {
  return new Promise((resolve) => {
    extractor.queue(async ({ page }) => {
      const blockedUrls = [
        "google-analytics.com",
        "https://ganalyticshub.net/",
      ];
      const blockedRequests = [
        "stylesheet",
        "gif",
        "png",
        "jpg",
        "svg+xml",
        "media",
        "font",
        "texttrack",
        "eventsource",
        "websocket",
        "manifest",
        "other",
      ];

      try {
        await page.setCacheEnabled(true);
        await page.setRequestInterception(true);
        await page.setExtraHTTPHeaders({ Referer: referer || "" });

        const extraction = new Promise(
          (resolveExtraction, rejectExtraction) => {
            let source = {
              sourceUrl: null,
              subtitles: subTarget === "0" ? [] : null,
            };

            const checkCompletion = () => {
              if (source.sourceUrl && source.subtitles) {
                resolveExtraction({ success: source });
              }
            };

            page.on("request", (request) => {
              if (
                blockedRequests.includes(request.resourceType()) ||
                blockedUrls.some((url) => request.url().includes(url))
              ) {
                request.abort();
              } else if (request.url().includes(sourceTarget)) {
                source.sourceUrl = request.url();

                request.abort();
                checkCompletion();
              } else {
                request.continue();
              }
            });

            if (subTarget != "0") {
              page.on("response", async (response) => {
                if (response.url().includes(subTarget)) {
                  const data = await response.json();
                  source.subtitles = data;
                  checkCompletion();
                }
              });
            }

            setTimeout(() => {
              rejectExtraction({ error: "TIMED-OUT" });
            }, timeout);
          }
        );

        await page.goto(embedUrl + "&_debug=true, {
          waitUntil: "domcontentloaded",
          timeout,
        });

        const result = await extraction;

        resolve(result);
      } catch (error) {
        resolve({ error: "TIMED-OUT" });
      }
    });
  });
};
/******************** UTILS ********************/

/******************** SERVER-LAUNCH ********************/
import EXPRESS from "express";

const MODULE_VERSION = "1.0.0";

const APP = EXPRESS();
let CLUSTER = await launch();

let ACTIVE = 0;
let LAST_RESET = 0;

APP.listen(process.env.PORT || 5000, () => {
  console.log(COLORS.green.underline(`🎉 SERVER STARTED 🎉`));
});

(() =>
  process.on("unhandledRejection", (reason) => {
    if (process.env.NODE_ENV === "DEV")
      console.error(`\nUNHANDLED PROCESS => ${reason}\n`);
  }))();
/******************** SERVER-LAUNCH ********************/

/******************** ROUTES ********************/
APP.get("/", async (req, res) => {
  res.status(200).json(`ROVER-MODULE [ ${MODULE_VERSION} ]`);
});

APP.get("/extract", async (req, res) => {
  const { url, sourceTarget, subTarget } = req.query;

  if (ACTIVE >= (Number(process.env.MAX_A) || 1)) {
    res.status(503).json("BUSY");
    return;
  }

  ACTIVE++;

  const { success, error } = await extract({
    extractor: CLUSTER,
    embedUrl: url,
    sourceTarget: sourceTarget || ".m3u8",
    subTarget: subTarget || "getSources",
  });

  ACTIVE--;

  if (error) {
    res.status(400).json(error);
    return;
  }

  res.status(200).json(success);
});

APP.get("/reset", async (req, res) => {
  const { key } = req.query;

  const now = Date.now();

  if (!key || key != "4848") {
    res.status(403).send();
    return;
  }

  LAST_RESET = now;
  ACTIVE = 0;

  console.log(
    `\n${COLORS.blue(
      `[RESET] ACTIVE COUNTER WAS RESET AT `
    )} ${COLORS.yellow.underline(new Date().toISOString())}\n`
  );

  res.status(200).json("SUCCESS");
});

APP.get("/status", async (_req, res) => {
  res.status(200).json(ACTIVE);
});
/******************** ROUTES ********************/
