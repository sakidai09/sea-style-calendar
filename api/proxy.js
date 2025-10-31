const ORIGIN = "https://sea-style-m.yamaha-motor.co.jp";

function getQueryValue(value) {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

async function readRequestBody(req) {
  if (req.body) {
    if (Buffer.isBuffer(req.body)) {
      return req.body;
    }
    if (typeof req.body === "string") {
      return Buffer.from(req.body);
    }
    if (typeof req.body === "object") {
      return Buffer.from(JSON.stringify(req.body));
    }
  }

  return await new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", (error) => reject(error));
  });
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,X-Requested-With");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  const targetPath = getQueryValue(req.query?.path);

  if (!targetPath) {
    res.status(400).json({ message: "path パラメータが必要です" });
    return;
  }

  try {
    const targetUrl = new URL(targetPath, ORIGIN);

    // 動作確認用のログを出力
    console.log("[proxy] 転送開始", {
      method: req.method,
      target: targetUrl.toString(),
    });

    const requestHeaders = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (!value) continue;
      if (["host", "content-length"].includes(key.toLowerCase())) continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          requestHeaders.append(key, item);
        }
      } else {
        requestHeaders.append(key, value);
      }
    }

    let bodyBuffer = null;
    if (req.method && !["GET", "HEAD"].includes(req.method.toUpperCase())) {
      bodyBuffer = await readRequestBody(req);
    }

    const response = await fetch(targetUrl, {
      method: req.method,
      headers: requestHeaders,
      body: bodyBuffer,
      redirect: "follow",
    });

    console.log("[proxy] 転送完了", {
      status: response.status,
      target: targetUrl.toString(),
    });

    res.status(response.status);
    for (const [key, value] of response.headers) {
      if (key.toLowerCase() === "content-length") continue;
      res.setHeader(key, value);
    }
    res.setHeader("Access-Control-Allow-Origin", "*");

    const responseBuffer = Buffer.from(await response.arrayBuffer());
    res.send(responseBuffer);
  } catch (error) {
    console.error("[proxy] 転送エラー", error);
    res.status(502).json({ message: "上流へのリクエストに失敗しました", detail: error.message || String(error) });
  }
};
