const express = require("express");
const http = require("http");
const zlib = require("zlib");
const querystring = require("querystring");

const app = express();
const PORT = process.env.PORT || 5000;

const CONFIG = {
  baseUrl: "http://www.timesms.net",
  username: "Junaidaliniz",
  password: "Junaidaliniz",
  userAgent: "Mozilla/5.0 (Linux; Android 13; V2040) Chrome/145.0.0.0 Mobile Safari/537.36"
};

let cookies = [];
let seenIds = new Set();

function getToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function makeRequest(method, path, data = null, extra = {}) {
  return new Promise((resolve, reject) => {
    const url = CONFIG.baseUrl + (path.startsWith("/") ? path : "/" + path);
    const headers = {
      "User-Agent": CONFIG.userAgent,
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "Accept-Encoding": "gzip, deflate",
      "Accept-Language": "en-PK,en;q=0.9",
      "Cookie": cookies.join("; "),
      ...extra
    };
    if (method === "POST" && data) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      headers["Content-Length"] = Buffer.byteLength(data);
      headers["Origin"] = CONFIG.baseUrl;
    }
    const req = http.request(url, { method, headers }, res => {
      if (res.headers["set-cookie"]) {
        res.headers["set-cookie"].forEach(c => {
          const part = c.split(";")[0];
          if (!cookies.includes(part)) cookies.push(part);
        });
      }
      const chunks = [];
      res.on("data", d => chunks.push(d));
      res.on("end", () => {
        let buf = Buffer.concat(chunks);
        if (res.headers["content-encoding"] === "gzip") {
          try { buf = zlib.gunzipSync(buf); } catch {}
        }
        resolve(buf.toString());
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
  const m = page.match(/What is (\d+)\s*\+\s*(\d+)/i);
  const capt = m ? Number(m[1]) + Number(m[2]) : 10;
  const form = querystring.stringify({ username: CONFIG.username, password: CONFIG.password, capt });
  await makeRequest("POST", "/signin", form, { Referer: `${CONFIG.baseUrl}/login`, Origin: CONFIG.baseUrl });
  console.log("[LOGIN] Done");
}

async function fetchTodaySMS() {
  await login();

  const today = getToday();

  // Parent page load
  try {
    await makeRequest("GET", "/agent/SMSCDRReports", null, { Referer: `${CONFIG.baseUrl}/agent/` });
  } catch {}

  // ✅ Server-side date filter — sirf aaj ki SMS
  const url = `/agent/res/data_smscdr.php?fdate1=${encodeURIComponent(today + " 00:00:00")}&fdate2=${encodeURIComponent(today + " 23:59:59")}&fg=0&iDisplayLength=2000`;

  let raw = await makeRequest("GET", url, null, {
    Referer: `${CONFIG.baseUrl}/agent/SMSCDRReports`,
    "X-Requested-With": "XMLHttpRequest"
  });

  // Blocked to retry
  if (raw.includes("Direct Script Access") || raw.includes("Please sign in")) {
    await login();
    await makeRequest("GET", "/agent/SMSCDRReports");
    raw = await makeRequest("GET", url, null, {
      Referer: `${CONFIG.baseUrl}/agent/SMSCDRReports`,
      "X-Requested-With": "XMLHttpRequest"
    });
  }

  let json;
  try { json = JSON.parse(raw); }
  catch { return { error: "Parse failed", preview: raw.substring(0, 300) }; }

  // ✅ Correct row mapping — row[5] mein message hota hai
  const rows = (json.aaData || [])
    .map(row => {
      const msg = (row[5] || "").replace(/legendhacker/gi, "").trim();
      if (!msg) return null;
      return {
        time:    row[0] || "",
        number:  row[1] || "",
        phone:   row[2] || "",
        service: row[3] || "",
        message: msg
      };
    })
    .filter(Boolean);

  console.log(`[SMS] Aaj ki (${today}): ${rows.length}`);
  return { date: today, total: rows.length, data: rows };
}

// ✅ Sirf nayi SMS
app.get("/api", async (req, res) => {
  const { type } = req.query;
  try {
    const result = await fetchTodaySMS();
    if (result.error) return res.json(result);

    if (type === "all") {
      // Saari aaj ki SMS
      seenIds.clear();
      result.data.forEach(r => seenIds.add(r.time));
      return res.json(result);
    }

    // Default: sirf nayi SMS
    const newData = result.data.filter(r => !seenIds.has(r.time));
    result.data.forEach(r => seenIds.add(r.time));

    return res.json({
      date: result.date,
      newCount: newData.length,
      newSms: newData
    });

  } catch (err) {
    console.error("[ERROR]", err.message);
    res.json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`TimeSMS Server on port ${PORT}`));
