const http = require("http");
const zlib = require("zlib");
const querystring = require("querystring");

const CONFIG = {
  baseUrl: "http://www.timesms.net",
  username: "Junaidaliniz",
  password: "Junaidaliniz",
  userAgent: "Mozilla/5.0 (Linux; Android 13; V2040 Build/TP1A.220624.014) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.7632.79 Mobile Safari/537.36",
};

let cookies = [];

function makeRequest(method, path, data = null, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const cleanPath = path.startsWith("/") ? path : "/" + path;
    const fullUrl = CONFIG.baseUrl + cleanPath;

    const headers = {
      "User-Agent": CONFIG.userAgent,
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "Accept-Encoding": "gzip, deflate",
      "Accept-Language": "en-PK,en;q=0.9",
      "Cookie": cookies.join("; "),
      ...extraHeaders,
    };

    if (method === "POST" && data) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      headers["Content-Length"] = Buffer.byteLength(data);
      headers["Origin"] = CONFIG.baseUrl;
    }

    const req = http.request(fullUrl, { method, headers }, (res) => {
      if (res.headers["set-cookie"]) {
        res.headers["set-cookie"].forEach((c) => {
          const part = c.split(";")[0];
          if (!cookies.includes(part)) cookies.push(part);
        });
      }
      const chunks = [];
      res.on("data", (d) => chunks.push(d));
      res.on("end", () => {
        let buffer = Buffer.concat(chunks);
        if (res.headers["content-encoding"] === "gzip") {
          try { buffer = zlib.gunzipSync(buffer); } catch {}
        }
        resolve(buffer.toString());
      });
    });

    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function login() {
  cookies = [];
  const page = await makeRequest("GET", "/login");
  const match = page.match(/What is (\d+)\s*\+\s*(\d+)\s*=?\s*\??/i);
  const capt = match ? Number(match[1]) + Number(match[2]) : 10;

  const form = querystring.stringify({
    username: CONFIG.username,
    password: CONFIG.password,
    capt,
  });

  await makeRequest("POST", "/signin", form, {
    Referer: `${CONFIG.baseUrl}/login`,
  });

  const test = await makeRequest("GET", "/agent/");
  if (test.includes("Please sign in") || test.includes("login")) {
    throw new Error("Login failed");
  }

  console.log("Login successful");
}

async function fetchTodaySMS() {
  // ✅ Sirf aaj ki date
  const today = new Date().toISOString().split("T")[0];

  console.log("============================================================");
  console.log("  TimeSMS - Sirf Aaj Ki SMS");
  console.log(`  Date: ${today}`);
  console.log("============================================================\n");

  await login();

  const params = [
    `fdate1=${encodeURIComponent(today + " 00:00:00")}`,
    `fdate2=${encodeURIComponent(today + " 23:59:59")}`,
    `frange=`, `fclient=`, `fnum=`, `fcli=`, `fg=0`,
    `iDisplayLength=2000`,
  ].join("&");

  try {
    await makeRequest("GET", "/agent/SMSCDRReports", null, {
      Referer: `${CONFIG.baseUrl}/agent/`,
    });
  } catch {}

  let raw = await makeRequest("GET", `/agent/res/data_smscdr.php?${params}`, null, {
    Referer: `${CONFIG.baseUrl}/agent/SMSCDRReports`,
    "X-Requested-With": "XMLHttpRequest",
    "Accept": "application/json, text/javascript, */*; q=0.01",
  });

  if (raw.includes("Direct Script Access") || raw.includes("Please sign in") || raw.includes("login")) {
    await login();
    await makeRequest("GET", "/agent/SMSCDRReports");
    raw = await makeRequest("GET", `/agent/res/data_smscdr.php?${params}`, null, {
      Referer: `${CONFIG.baseUrl}/agent/SMSCDRReports`,
      "X-Requested-With": "XMLHttpRequest",
    });
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    console.error("Response parse error:", raw.substring(0, 300));
    process.exit(1);
  }

  const rows = data.aaData || [];

  const messages = rows.map((row) => {
    const msg = (row[5] || "").replace(/legendhacker/gi, "").trim();
    if (!msg) return null;
    return {
      time:    row[0] || "",
      number:  row[2] || "",
      service: row[3] || "",
      message: msg,
      cost:    row[7] || 0,
    };
  }).filter(Boolean);

  console.log(`Aaj ki total SMS: ${messages.length}`);
  console.log("------------------------------------------------------------");

  messages.forEach((m, i) => {
    console.log(`\n[${i + 1}]`);
    console.log(`  Time    : ${m.time}`);
    console.log(`  Number  : ${m.number}`);
    console.log(`  Service : ${m.service}`);
    console.log(`  Message : ${m.message}`);
    console.log(`  Cost    : $${m.cost}`);
  });

  console.log("\n============================================================");
  console.log(`Total: ${messages.length} SMS - ${today}`);
  console.log("============================================================");
}

fetchTodaySMS().catch((err) => {
  console.error("Error:", err.message || err);
  process.exit(1);
});
