const express = require("express");
let SwissVedic = null;
try { SwissVedic = require('./swiss_vedic'); } catch (e) { console.error('Swiss Ephemeris module unavailable:', e.message); }
const crypto = require("crypto");
const Razorpay = require("razorpay");
let advancedAstrology = null;
let phase4Dasa = null;
try { advancedAstrology = require('./astro_advanced').advanced; } catch (e) { console.error('Advanced astrology module unavailable:', e.message); }
try { phase4Dasa = require('./dasa_engine').phase4Dasa; } catch (e) { console.error('Phase 4 Dasa engine unavailable:', e.message); }
let TransitPanchang = null;
try { TransitPanchang = require('./transit_panchang'); } catch (e) { console.error('Transit/Panchang module unavailable:', e.message); }
const admin = require("firebase-admin");
let Astronomy = null;
try { Astronomy = require("astronomy-engine"); } catch (_) {
  console.warn("astronomy-engine is not installed. Install dependencies before using /api/horoscope/calculate.");
}


const app = express();
const PORT = process.env.PORT || 10000;
const ADMIN_UID = String(process.env.ADMIN_UID || "TwjeEIFS3Zcf1SxboLZoujm91Ky2").trim();

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: String(process.env.FIREBASE_PRIVATE_KEY || "")
        .replace(/^['"]|['"]$/g, "")
        .replace(/\\n/g, "\n")
        .trim()
    })
  });
}
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const RAZORPAY_KEY_ID = String(process.env.RAZORPAY_KEY_ID || "").trim();
const RAZORPAY_KEY_SECRET = String(process.env.RAZORPAY_KEY_SECRET || "").trim();
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || "").trim();
const RESEND_API_KEY = String(process.env.RESEND_API_KEY || "").trim();
const RESEND_FROM = String(process.env.RESEND_FROM || "onboarding@resend.dev").trim();
const RESEND_TEST_RECIPIENT = String(process.env.RESEND_TEST_RECIPIENT || ADMIN_EMAIL || "").trim();
const GEMINI_API_KEY = String(process.env.GEMINI_API_KEY || "").trim();
const GEMINI_MODEL = String(process.env.GEMINI_MODEL || "gemini-3.7-flash").trim();
const GEMINI_TRANSLATION_FALLBACK_MODELS = [GEMINI_MODEL, "gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-2.5-flash", "gemini-3.1-pro-preview"].filter((v,i,a)=>v && a.indexOf(v)===i);
// OpenAI is used ONLY for English → Tamil blog translation. Other Gemini-powered
// horoscope features remain unchanged. The API key never reaches the browser.
const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || "").trim();
const OPENAI_TRANSLATION_MODEL = String(process.env.OPENAI_TRANSLATION_MODEL || "gpt-5.6-luna").trim();
const OPENAI_TRANSLATION_FALLBACK_MODELS = [OPENAI_TRANSLATION_MODEL, "gpt-5.6-luna", "gpt-5.6-terra"].filter((v,i,a)=>v && a.indexOf(v)===i);
const AI_RATE_LIMIT_MAX = Number(process.env.AI_RATE_LIMIT_MAX || 10);
const AI_RATE_LIMIT_WINDOW_MS = Number(process.env.AI_RATE_LIMIT_WINDOW_MS || 10 * 60 * 1000);
const aiRateBuckets = new Map();
// SMTP is retained as an optional fallback for paid Render services. Render Free
// services block outbound SMTP ports 25/465/587, so Resend HTTP API is preferred.
const SMTP_HOST = String(process.env.SMTP_HOST || "").trim();
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = String(process.env.SMTP_USER || "").trim();
const SMTP_PASS = String(process.env.SMTP_PASS || "").trim();
const SMTP_FROM = String(process.env.SMTP_FROM || SMTP_USER || "").trim();
let smtpTransport = null;
try {
  const nodemailer = require("nodemailer");
  if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
    smtpTransport = nodemailer.createTransport({
      host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000
    });
  }
} catch (_) {}

async function sendEmail({to, subject, text, html, replyTo}) {
  const recipients = Array.isArray(to) ? to.filter(Boolean) : [to].filter(Boolean);
  if (!recipients.length) throw new Error("No recipient email address is available.");
  if (RESEND_API_KEY) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: RESEND_FROM,
          to: recipients,
          subject,
          text,
          html,
          ...(replyTo ? { reply_to: replyTo } : {})
        }),
        signal: controller.signal
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = body?.message || body?.name || `Resend API returned HTTP ${r.status}`;
        throw new Error(msg);
      }
      return body;
    } finally { clearTimeout(timer); }
  }
  if (smtpTransport) {
    return smtpTransport.sendMail({ from: SMTP_FROM, to: recipients, replyTo, subject, text, html });
  }
  throw new Error("Email provider is not configured. Set RESEND_API_KEY and RESEND_FROM in Render.");
}

async function getUserEmail(uid) {
  if (!uid) return "";
  try {
    const u = await admin.auth().getUser(uid);
    if (u?.email) return String(u.email).trim();
  } catch (_) {}
  try {
    const s = await db.collection("smv_users").doc(uid).get();
    return String(s.data()?.email || "").trim();
  } catch (_) { return ""; }
}

function uniqueRecipients(list) {
  return [...new Set((list || []).map(x => String(x || "").trim()).filter(Boolean))];
}

async function sendSystemEmail({ to = [], subject, text, replyTo }) {
  const recipients = uniqueRecipients(to);
  if (!recipients.length) return { skipped: true };
  try {
    return await sendEmail({ to: recipients, subject, text, replyTo });
  } catch (e) {
    console.error("System email failed:", subject, e?.message || e);
    return { failed: true, error: e?.message || String(e) };
  }
}

async function sendAdminTransactionEmail({ eventType, paymentId, orderId, amount, currency, questionId, customerEmail, status }) {
  if (!ADMIN_EMAIL) return;
  const subject = `SMV ASTRO Transaction — ${eventType}`;
  const text = [
    "SMV ASTRO Transaction Notification",
    "",
    `Event: ${eventType}`,
    `Status: ${status || eventType}`,
    `Amount: ${amount != null ? `${amount} ${currency || "INR"}` : "N/A"}`,
    `Razorpay Payment ID: ${paymentId || "N/A"}`,
    `Razorpay Order ID: ${orderId || "N/A"}`,
    `Question ID: ${questionId || "N/A"}`,
    `Customer Email: ${customerEmail || "N/A"}`,
    `Time: ${new Date().toISOString()}`
  ].join("\n");
  await sendSystemEmail({ to: [ADMIN_EMAIL], subject, text, replyTo: customerEmail || ADMIN_EMAIL });
}
if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
  console.error("Razorpay credentials are missing. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in Render.");
}
const razorpay = new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET });

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",").map(x => x.trim()).filter(Boolean);
// Parse JSON request bodies for normal API routes. Keep Razorpay webhook raw so its
// HMAC signature can still be verified against the original request bytes.
app.use((req, res, next) => {
  if (req.path === "/razorpay/webhook") return next();
  return express.json({ limit: "15mb" })(req, res, next);
});

app.use((req, res, next) => {
  // The Blogger frontend uses Firebase ID-token Authorization headers, not
  // cookie credentials, so wildcard CORS is safe for this API and prevents
  // Blogger/custom-domain deployments from failing with a browser
  // "Failed to fetch" before the request reaches Express.
  const origin = req.headers.origin;
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

async function requireUser(req, res) {
  const header = String(req.get("Authorization") || "");
  if (!header.startsWith("Bearer ")) {
    res.status(401).json({ error: "Login session is missing. Please login again." });
    return null;
  }
  try {
    return await admin.auth().verifyIdToken(header.slice(7));
  } catch (e) {
    console.error("Firebase token verification failed:", e?.message || e);
    res.status(401).json({ error: "Login session expired. Please login again." });
    return null;
  }
}

async function isAdminUser(user) {
  if (!user) return false;
  if (user.uid === ADMIN_UID) return true;
  if (user.admin === true || user.role === "admin") return true;
  try {
    const snap = await db.collection("smv_users").doc(user.uid).get();
    return snap.exists && String(snap.data()?.role || "").toLowerCase() === "admin";
  } catch (e) {
    console.error("Admin role lookup failed:", e?.message || e);
    return false;
  }
}

function signatureEqual(expected, actual) {
  const a = Buffer.from(String(expected || ""));
  const b = Buffer.from(String(actual || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}


// Registration profile endpoints: Firestore profile/counter writes are performed
// server-side with Firebase Admin SDK so customer/astrologer registration does
// not depend on client Firestore Rules for protected counter/profile writes.
function indiaDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date).reduce((o, p) => { o[p.type] = p.value; return o; }, {});
  return `${parts.day}${parts.month}${parts.year}`;
}

async function nextCustomerId() {
  // Customer IDs are date-based in India (IST): SMV-CUS-DDMMYYYY-01, -02, ...
  const dateKey = indiaDateKey();
  const ref = db.collection("smv_counters").doc(`customer_${dateKey}`);
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const next = (snap.exists ? Number(snap.data()?.lastNumber || 0) : 0) + 1;
    tx.set(ref, { lastNumber: next, dateKey, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return `SMV-CUS-${dateKey}-${String(next).padStart(2, "0")}`;
  });
}

app.post("/lookup-customer-login", async (req, res) => {
  try {
    const customerId = String(req.body?.customerId || "").trim().toUpperCase();
    if (!/^SMV-CUS-\d{8}-\d{2,}$/.test(customerId)) {
      return res.status(400).json({ error: "Enter a valid Customer ID, for example SMV-CUS-20082026-01." });
    }
    const snap = await db.collection("smv_users").where("publicId", "==", customerId).limit(1).get();
    if (snap.empty) return res.status(404).json({ error: "Customer ID was not found. Please check your Customer ID." });
    const data = snap.docs[0].data() || {};
    if (String(data.role || "").toLowerCase() !== "customer") return res.status(403).json({ error: "This ID is not a customer login ID." });
    const uid = String(data.uid || snap.docs[0].id);
    const user = await admin.auth().getUser(uid);
    if (!user.email) return res.status(400).json({ error: "This Customer account has no login email configured." });
    return res.json({ ok: true, email: user.email, customerId });
  } catch (e) {
    console.error("Customer ID lookup error:", e);
    return res.status(500).json({ error: "Customer ID login lookup failed. Please try again." });
  }
});

async function nextPublicId(prefix, dateKey) {
  const isCustomer = prefix === "CS";
  const kind = isCustomer ? "customer" : "astrologer";
  const ref = db.collection("smv_counters").doc(`${kind}_${dateKey}`);
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const next = (snap.exists ? Number(snap.data()?.lastNumber || 0) : 0) + 1;
    tx.set(ref, { lastNumber: next, dateKey, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    const idPrefix = isCustomer ? "SMV-CUS" : "SMV-AST";
    return `${idPrefix}-${dateKey}-${String(next).padStart(2, "0")}`;
  });
}

app.post("/lookup-id-login", async (req, res) => {
  try {
    const publicId = String(req.body?.publicId || "").trim().toUpperCase();
    if (!/^SMV-(CUS|AST)-\d{8}-\d{2,}$/.test(publicId)) {
      return res.status(400).json({ error: "Enter a valid Customer or Astrologer ID." });
    }
    const snap = await db.collection("smv_users").where("publicId", "==", publicId).limit(1).get();
    if (snap.empty) return res.status(404).json({ error: "This ID was not found. Please check the ID and try again." });
    const data = snap.docs[0].data() || {};
    const expectedRole = publicId.startsWith("SMV-AST-") ? "astrologer" : "customer";
    if (String(data.role || "").toLowerCase() !== expectedRole) return res.status(403).json({ error: "This ID is not valid for this login type." });
    const uid = String(data.uid || snap.docs[0].id);
    const user = await admin.auth().getUser(uid);
    if (!user.email) return res.status(400).json({ error: "This account has no login email configured." });
    return res.json({ ok: true, email: user.email, publicId, role: expectedRole });
  } catch (e) {
    console.error("ID login lookup error:", e);
    return res.status(500).json({ error: "ID login lookup failed. Please try again." });
  }
});

app.post("/register-customer-profile", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  try {
    const name = String(req.body?.name || "").trim();
    const phone = String(req.body?.phone || "").trim();
    if (!name || name.length > 120) return res.status(400).json({ error: "A valid customer name is required." });
    if (phone.length > 30) return res.status(400).json({ error: "Invalid mobile number." });
    const ref = db.collection("smv_users").doc(user.uid);
    const existing = await ref.get();
    if (existing.exists && String(existing.data()?.role || "").toLowerCase() === "customer" && existing.data()?.publicId) {
      return res.json({ ok: true, alreadyRegistered: true, publicId: existing.data().publicId });
    }
    const publicId = await nextCustomerId();
    await ref.set({
      uid: user.uid, name, phone, email: user.email || "", role: "customer",
      status: "active", publicId, customerId: publicId, emailVerificationRequired: true,
      createdAt: existing.exists ? (existing.data()?.createdAt || FieldValue.serverTimestamp()) : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return res.json({ ok: true, publicId });
  } catch (e) {
    console.error("Customer registration profile error:", e);
    return res.status(500).json({ error: "Customer profile setup failed on the server. Please try again." });
  }
});

app.post("/register-astrologer-profile", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  try {
    const b = req.body || {};
    const name=String(b.name||"").trim(), mobile=String(b.mobile||"").trim(), specialization=String(b.specialization||"").trim();
    const experience=Number(b.experience||0), bio=String(b.bio||"").trim();
    const bankName=String(b.bankName||"").trim(), accountName=String(b.accountName||"").trim(), accountNumber=String(b.accountNumber||"").trim(), ifsc=String(b.ifsc||"").trim(), upi=String(b.upi||"").trim(), photoData=String(b.photoData||"");
    if(!name||!mobile||!specialization||!bio||!bankName||!accountName||!accountNumber||!ifsc||!photoData) return res.status(400).json({error:"Please complete all required astrologer registration details."});
    if(!Number.isFinite(experience)||experience<0) return res.status(400).json({error:"Invalid experience."});
    const userRef=db.collection("smv_users").doc(user.uid), astroRef=db.collection("smv_astrologers").doc(user.uid), payoutRef=db.collection("smv_payouts").doc(user.uid);
    const existing=await userRef.get();
    if(existing.exists && String(existing.data()?.role||"").toLowerCase()==="astrologer" && existing.data()?.publicId) return res.json({ok:true,alreadyRegistered:true,publicId:existing.data().publicId});
    const dateKey=indiaDateKey(), publicId=await nextPublicId("AT",dateKey);
    const batch=db.batch();
    batch.set(userRef,{uid:user.uid,name,phone:mobile,mobile,email:user.email||"",publicId,role:"astrologer",status:"pending",emailVerificationRequired:true,createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()},{merge:true});
    batch.set(astroRef,{uid:user.uid,name,publicId,specialization,expertise:specialization,experience,about:bio,bio,photoData,status:"pending",role:"astrologer",createdAt:FieldValue.serverTimestamp()},{merge:true});
    batch.set(payoutRef,{uid:user.uid,bankName,accountName,accountNumber,ifsc,upi,updatedAt:FieldValue.serverTimestamp(),status:"pending_admin_review"},{merge:true});
    batch.set(db.collection("smv_notifications").doc(user.uid+"_"+Date.now()),{userId:user.uid,type:"registration",title:"Registration submitted",message:"Your astrologer application is pending Admin approval.",createdAt:FieldValue.serverTimestamp(),read:false});
    await batch.commit();
    return res.json({ok:true,publicId});
  } catch(e){ console.error("Astrologer registration profile error:",e); return res.status(500).json({error:"Astrologer profile setup failed on the server. Please try again."}); }
});

app.get("/", (req, res) => res.status(200).json({
  service: "SMV ASTRO Razorpay Backend",
  version: "2026-08-22-v130-time-debug-fix",
  status: "online",
  razorpay: "enabled",
  firebase: "enabled"
}));

app.get("/test-razorpay", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (!(await isAdminUser(user))) return res.status(403).json({ error: "Admin access required." });
  try {
    if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) return res.status(500).json({ ok: false, error: "Razorpay credentials are missing in Render." });
    const mode = RAZORPAY_KEY_ID.startsWith("rzp_test_") ? "test" : (RAZORPAY_KEY_ID.startsWith("rzp_live_") ? "live" : "unknown");
    await razorpay.orders.all({ count: 1 });
    return res.json({ ok: true, mode, keyPrefix: RAZORPAY_KEY_ID.slice(0, 9), message: `Razorpay ${mode} credentials accepted by Render.` });
  } catch (e) {
    console.error("Razorpay connection test failed:", e);
    return res.status(502).json({ error: e?.error?.description || e?.description || e?.message || "Razorpay connection failed." });
  }
});


function escapeHtmlEmail(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[c]));
}


app.post("/contact-query", express.json({ limit: "20kb" }), async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").trim();
    const place = String(req.body?.place || "").trim();
    const mobile = String(req.body?.mobile || "").trim();
    const query = String(req.body?.query || "").trim();

    if (!name || !email || !place || !mobile || !query) {
      return res.status(400).json({ error: "Please fill all required fields." });
    }
    if (name.length > 100 || email.length > 160 || place.length > 120 || mobile.length > 20 || query.length > 3000) {
      return res.status(400).json({ error: "One or more fields are too long." });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Please enter a valid email address." });
    }
    if (!ADMIN_EMAIL || (!RESEND_API_KEY && !smtpTransport)) {
      console.error("Contact email configuration is missing. Set ADMIN_EMAIL and RESEND_API_KEY/RESEND_FROM in Render.");
      return res.status(503).json({ error: "Email service is not configured. Add RESEND_API_KEY and RESEND_FROM in Render." });
    }

    const ref = db.collection("contactQueries").doc();
    const createdAt = FieldValue.serverTimestamp();
    await ref.set({
      name, email, place, mobile, query,
      status: "new",
      createdAt,
      source: "website-contact-form"
    });

    const subject = "SMV ASTRO Query";
    const text = [
      "SMV ASTRO QUERY",
      "Hello.",
      "",
      `Name: ${name}`,
      `Email: ${email}`,
      `Place: ${place}`,
      `Mobile: ${mobile}`,
      "",
      "Query:",
      query,
      "",
      `Query ID: ${ref.id}`
    ].join("\n");

    const htmlBody = `
      <div style="font-family:Arial,sans-serif;line-height:1.6">
        <h2 style="color:#7e1818">SMV ASTRO QUERY</h2>
        <p>Hello.</p>
        <p><b>Name:</b> ${escapeHtmlEmail(name)}</p>
        <p><b>Email:</b> ${escapeHtmlEmail(email)}</p>
        <p><b>Place:</b> ${escapeHtmlEmail(place)}</p>
        <p><b>Mobile:</b> ${escapeHtmlEmail(mobile)}</p>
        <p><b>Query:</b></p>
        <div style="white-space:pre-wrap;border:1px solid #ddd;padding:12px;border-radius:8px">${escapeHtmlEmail(query)}</div>
        <p><small>Query ID: ${escapeHtmlEmail(ref.id)}</small></p>
      </div>`;

    const contactRecipient = RESEND_API_KEY ? (RESEND_TEST_RECIPIENT || ADMIN_EMAIL) : ADMIN_EMAIL;
    await sendEmail({ to: contactRecipient, replyTo: email, subject, text, html: htmlBody });

    return res.status(200).json({ ok: true, queryId: ref.id });
  } catch (e) {
    console.error("Contact query failed:", e);
    return res.status(502).json({ error: e?.message || "Unable to send your query right now. Please try again later." });
  }
});







async function writeAdminAudit(action, questionId, userId, details = {}) {
  try {
    await db.collection("smv_admin_audit").add({
      action, questionId: questionId || null, actorUid: userId || null,
      details, createdAt: FieldValue.serverTimestamp()
    });
  } catch (e) {
    console.error("Admin audit write issue:", e?.message || e);
  }
}

/**
 * Re-open an astrologer answer for editing/resubmission.
 *
 * This route intentionally uses the trusted Firebase Admin SDK so the browser
 * does not need direct Firestore write permission for workflow/status fields.
 * The same question is returned to the Astrologer Question Box; no new
 * question is created and the existing answer is preserved for editing.
 */
app.post("/astrologer/edit-answer", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const questionId = String(req.body?.questionId || "").trim();
  if (!questionId) {
    return res.status(400).json({ error: "Question ID is required." });
  }

  try {
    const questionRef = db.collection("smv_questions").doc(questionId);
    const snap = await questionRef.get();
    if (!snap.exists) {
      return res.status(404).json({ error: "Question not found." });
    }

    const q = snap.data() || {};
    if (String(q.astrologerId || "") !== String(user.uid)) {
      return res.status(403).json({ error: "This question is not assigned to you." });
    }

    // Approved/final answers can never be reopened by the astrologer.
    if (String(q.status || "") === "answered" ||
        String(q.astrologerAnswerStatus || "") === "approved") {
      return res.status(409).json({ error: "This answer has already been approved and is final." });
    }

    // Only submitted answers waiting for approval or requiring revision can
    // be reopened. A draft/unanswered question is already in the Question Box.
    const allowedStatuses = ["processing", "answer_draft", "admin_review", "revision_required"];
    const status = String(q.status || "");
    const hasAnswer = !!String(q.answer || "").trim();
    if (!hasAnswer || (!allowedStatuses.includes(status) && q.astrologerEditMode !== true)) {
      return res.status(409).json({ error: "This answer is not available for editing right now." });
    }

    await questionRef.update({
      // Keep the same question and same astrologer allocation.
      allocationStatus: "claimed_by_astrologer",
      astrologerEditMode: true,
      // admin_approved here means the QUESTION was approved/allocated, not
      // that the ANSWER was approved. /submit-answer moves it back to processing.
      status: "admin_approved",
      astrologerAnswerStatus: "draft",
      editReopenedAt: FieldValue.serverTimestamp(),
      editReopenedBy: user.uid,
      updatedAt: FieldValue.serverTimestamp()
    });

    await writeAdminAudit("ASTROLOGER_ANSWER_REOPENED_FOR_EDIT", questionId, user.uid, {
      previousStatus: status,
      nextStatus: "admin_approved"
    });

    return res.json({ success: true, questionId, status: "admin_approved", astrologerEditMode: true });
  } catch (e) {
    console.error("Astrologer answer edit reopen failed:", e);
    return res.status(500).json({ error: e?.message || "Unable to open answer for editing." });
  }
});

/**
 * Server-side astrologer answer submission.
 *
 * The answer is written by the trusted backend first. Email notification is
 * then attempted from the server (never from the browser), and the result of
 * each recipient is persisted in the question document.
 */
app.post("/submit-answer", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const questionId = String(req.body?.questionId || "").trim();
  const answer = String(req.body?.answer || "").trim();

  try {
    if (!questionId || !answer) {
      return res.status(400).json({ error: "Question ID and answer are required." });
    }

    const questionRef = db.collection("smv_questions").doc(questionId);
    const snap = await questionRef.get();
    if (!snap.exists) return res.status(404).json({ error: "Question not found." });

    const q = snap.data() || {};
    if (String(q.astrologerId || "") !== String(user.uid)) {
      return res.status(403).json({ error: "This question is not assigned to you." });
    }

    // Astrologer may edit and resubmit the answer while it is still waiting
    // for Admin approval. Once Admin approves it (status = answered), editing
    // is no longer allowed.
    const editableStatuses = ["admin_approved", "revision_required", "processing", "admin_review"];
    if (!editableStatuses.includes(String(q.status || ""))) {
      return res.status(409).json({ error: "This answer can no longer be edited." });
    }

    const minWords = Number(q.answerMinWords || 150);
    const wordCount = answer.split(/\s+/).filter(Boolean).length;
    if (wordCount < minWords) {
      return res.status(400).json({ error: `Please write at least ${minWords} words.` });
    }

    // Translate the submitted answer to Tamil on the trusted Render server.
    // The original validation above remains unchanged; only the stored answer
    // is converted to the Tamil site language.
    const translatedAnswer = await translateAnswerToTamil(answer);

    const commissionPercent = Number(q.commissionPercent || q.commissionRate || 20);
    const commissionAmount =
      Math.round(Number(q.amount || 0) * commissionPercent) / 100;

    // Save the answer before attempting email. This makes the submission
    // independent of browser notification calls and email-provider latency.
    await questionRef.update({
      answer: translatedAnswer,
      answerWordCount: translatedAnswer.split(/\s+/).filter(Boolean).length,
      answerSubmittedAt: FieldValue.serverTimestamp(),
      astrologerAnswerStatus: "submitted",
      // Once resubmitted, remove edit mode so the same question is no longer
      // shown in both the Question Box and Answers section.
      astrologerEditMode: false,
      status: "processing",
      astrologerCommissionAmount: commissionAmount,
      commissionPercent,
      commissionRate: commissionPercent,
      commissionStatus: "pending_admin_approval",
      answerEmailStatus: {
        state: "pending",
        updatedAt: FieldValue.serverTimestamp()
      }
    });

    await writeAdminAudit("ASTROLOGER_ANSWER_SUBMITTED", questionId, user.uid, {
      wordCount, previousStatus: String(q.status || ""), nextStatus: "processing"
    });

    const customerEmail = String(
      q.customerEmail || await getUserEmail(q.customerId) || ""
    ).trim();
    const customerName = String(q.customerName || q.birthName || "Customer");
    const astrologerEmail = String(await getUserEmail(q.astrologerId) || "").trim();
    const astrologerName = String(q.astrologerName || "Astrologer");

    const subject = "SMV ASTRO — Astrologer answer submitted";
    const text = [
      `Dear ${customerName},`,
      "",
      `${astrologerName} has submitted an answer to your astrology question. It is now waiting for Admin review.`,
      "",
      `Question: ${q.question || ""}`,
      `Question ID: ${questionId}`,
      "",
      "Regards,",
      "SMV ASTRO"
    ].join("\n");

    const recipients = uniqueRecipients([customerEmail, ADMIN_EMAIL]);
    const emailResults = {};
    const emailStatusPatch = {
      state: "completed",
      updatedAt: FieldValue.serverTimestamp()
    };

    if (!recipients.length) {
      const error = "No customer or admin email address is configured.";
      console.error(`Resend delivery issue | Question ID: ${questionId} | Reason: ${error}`);
      emailStatusPatch.state = "failed";
      emailStatusPatch.error = error;
      emailStatusPatch.recipients = {};
    } else {
      for (const recipient of recipients) {
        const recipientKey = recipient.toLowerCase();
        const result = await sendSystemEmail({
          to: [recipient],
          replyTo: ADMIN_EMAIL || astrologerEmail || customerEmail,
          subject,
          text
        });

        if (result?.failed) {
          emailResults[recipientKey] = {
            status: "failed",
            error: String(result.error || "Unknown email error")
          };
          console.error(
            `Resend delivery issue | Question ID: ${questionId} | Recipient Email: ${recipient} | Reason: ${result.error || "Unknown email error"}`
          );
        } else {
          emailResults[recipientKey] = {
            status: "sent",
            messageId: result?.id || null
          };
          console.log(
            `ANSWER EMAIL SENT | Question ID: ${questionId} | Recipient Email: ${recipient}`
          );
        }
      }

      const failed = Object.values(emailResults).some(x => x.status === "failed");
      emailStatusPatch.state = failed
        ? (Object.values(emailResults).every(x => x.status === "failed") ? "failed" : "partial")
        : "sent";
      emailStatusPatch.recipients = emailResults;
    }

    await questionRef.set({ answerEmailStatus: emailStatusPatch }, { merge: true });

    // Email delivery is intentionally independent from the business workflow.
    // Never expose Resend/email delivery state to Customer or Astrologer UI.
    return res.json({
      ok: true,
      answerSaved: true,
      status: "processing"
    });
  } catch (e) {
    console.error(
      `Answer submission failed | Question ID: ${questionId || "N/A"} | Reason:`,
      e?.message || e
    );
    return res.status(500).json({
      error: e?.message || "Unable to submit answer."
    });
  }
});

app.post("/question-notify", express.json({limit:"20kb"}), async(req,res)=>{
  const user=await requireUser(req,res); if(!user)return;
  try{
    if(!ADMIN_EMAIL || (!RESEND_API_KEY && !smtpTransport)) return res.status(503).json({error:"Email service is not configured in Render. Set ADMIN_EMAIL, RESEND_API_KEY and RESEND_FROM."});
    const questionId=String(req.body?.questionId||"").trim();
    const event=String(req.body?.event||"").trim();
    const reason=String(req.body?.reason||"").trim();
    const allowed=["payment_verified","question_approved","question_rejected","answer_submitted","answer_approved","answer_rejected"];
    if(!questionId||!allowed.includes(event)) return res.status(400).json({error:"Invalid question notification request."});
    const qSnap=await db.collection("smv_questions").doc(questionId).get();
    if(!qSnap.exists) return res.status(404).json({error:"Question not found."});
    const q=qSnap.data()||{};
    const isAdmin=await isAdminUser(user);
    const isCustomer=q.customerId===user.uid;
    const isAstrologer=q.astrologerId===user.uid;
    if(event==="payment_verified" && !isCustomer) return res.status(403).json({error:"Only the question owner can send this notification."});
    if(["question_approved","question_rejected","answer_approved","answer_rejected"].includes(event) && !isAdmin) return res.status(403).json({error:"Admin access required for this notification."});
    if(event==="answer_submitted" && !isAstrologer) return res.status(403).json({error:"Only the assigned astrologer can send this notification."});

    async function userEmail(uid){
      if(!uid)return "";
      try{const u=await admin.auth().getUser(uid);return String(u.email||"").trim();}catch(e){}
      try{const s=await db.collection("smv_users").doc(uid).get();return String(s.data()?.email||"").trim();}catch(e){return "";}
    }
    const customerEmail=String(q.customerEmail||await userEmail(q.customerId)||"").trim();
    const astrologerEmail=await userEmail(q.astrologerId);
    const customerName=String(q.customerName||q.birthName||"Customer");
    const astrologerName=String(q.astrologerName||"Astrologer");
    let subject="", text="", to=[];
    if(event==="payment_verified"){
      if(customerEmail)to=[customerEmail]; subject="SMV ASTRO — Question payment received"; text=`Dear ${customerName},\n\nYour payment for your astrology question has been successfully verified. Your question is now waiting for Admin approval.\n\nQuestion: ${q.question||""}\nQuestion ID: ${questionId}\n\nRegards,\nSMV ASTRO`;
    } else if(event==="question_approved"){
      if(customerEmail)to=[customerEmail]; subject="SMV ASTRO — Your question has been approved"; text=`Dear ${customerName},\n\nYour paid astrology question has been approved by Admin and is now available to an approved astrologer.\n\nQuestion: ${q.question||""}\nQuestion ID: ${questionId}\n\nRegards,\nSMV ASTRO`;
    } else if(event==="question_rejected"){
      if(customerEmail)to=[customerEmail]; subject="SMV ASTRO — Question update"; text=`Dear ${customerName},\n\nYour astrology question was not approved by Admin.\n\nReason: ${reason||"Please contact SMV ASTRO."}\nQuestion ID: ${questionId}\n\nRegards,\nSMV ASTRO`;
    } else if(event==="answer_submitted"){
      if(customerEmail)to=[customerEmail]; if(ADMIN_EMAIL&&!to.includes(ADMIN_EMAIL))to.push(ADMIN_EMAIL); subject="SMV ASTRO — Astrologer answer submitted"; text=`Dear ${customerName},\n\n${astrologerName} has submitted an answer to your astrology question. It is now waiting for Admin review.\n\nQuestion: ${q.question||""}\nQuestion ID: ${questionId}\n\nRegards,\nSMV ASTRO`;
    } else if(event==="answer_approved"){
      if(customerEmail)to.push(customerEmail); if(astrologerEmail&&!to.includes(astrologerEmail))to.push(astrologerEmail); subject="SMV ASTRO — Astrology answer approved"; text=`Your astrology answer has been approved by SMV ASTRO Admin.\n\nQuestion: ${q.question||""}\nQuestion ID: ${questionId}\n\nThe customer can now view the approved answer.`;
    } else if(event==="answer_rejected"){
      if(astrologerEmail)to=[astrologerEmail]; subject="SMV ASTRO — Answer revision required"; text=`Dear ${astrologerName},\n\nYour submitted answer requires revision.\n\nReason: ${reason||"Please review and resubmit the answer."}\nQuestion ID: ${questionId}\n\nRegards,\nSMV ASTRO`;
    }
    // Every question/answer event keeps a master copy for the Admin.
    if (ADMIN_EMAIL && !to.includes(ADMIN_EMAIL)) to.push(ADMIN_EMAIL);
    to = uniqueRecipients(to);
    if(!to.length) return res.status(400).json({error:"No recipient email address is available for this update."});
    await sendSystemEmail({to,replyTo:ADMIN_EMAIL,subject,text});
    return res.json({ok:true,recipients:to.length,event});
  }catch(e){console.error("Question notification failed:",e);return res.status(500).json({error:"Unable to send question update email right now."});}
});


async function nextQuestionId() {
  const dateKey = indiaDateKey();
  const ref = db.collection("smv_counters").doc(`question_${dateKey}`);
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const next = (snap.exists ? Number(snap.data()?.lastNumber || 0) : 0) + 1;
    tx.set(ref, { lastNumber: next, dateKey, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return `SMV-QST-${dateKey}-${String(next).padStart(2, "0")}`;
  });
}

function nextPaymentIdInTransaction(dateKey, snap) {
  const next = (snap.exists ? Number(snap.data()?.lastNumber || 0) : 0) + 1;
  return {
    id: `SMV-PAY-${dateKey}-${String(next).padStart(2, "0")}`,
    next
  };
}


async function nextPaymentId() {
  const dateKey = indiaDateKey();
  const ref = db.collection("smv_counters").doc(`payment_${dateKey}`);
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const next = (snap.exists ? Number(snap.data()?.lastNumber || 0) : 0) + 1;
    tx.set(ref, { lastNumber: next, dateKey, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return `SMV-PAY-${dateKey}-${String(next).padStart(2, "2")}`;
  });
}

async function nextBookingId() {
  const dateKey = indiaDateKey();
  const ref = db.collection("smv_counters").doc(`booking_${dateKey}`);
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const next = (snap.exists ? Number(snap.data()?.lastNumber || 0) : 0) + 1;
    tx.set(ref, { lastNumber: next, dateKey, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return `SMV-BKG-${dateKey}-${String(next).padStart(2, "0")}`;
  });
}

app.post("/appointment-booking", express.json({ limit: "20kb" }), async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  try {
    const name=String(req.body?.name||"").trim(), email=String(req.body?.email||user.email||"").trim(), mobile=String(req.body?.mobile||"").trim();
    const type=String(req.body?.type||"").trim(), preferredDate=String(req.body?.preferredDate||"").trim(), preferredTime=String(req.body?.preferredTime||"").trim(), notes=String(req.body?.notes||"").trim();
    if(!name||!email||!mobile||!type||!preferredDate||!preferredTime) return res.status(400).json({error:"Please fill all required appointment fields."});
    if(!["Chat Consultation","Call Consultation"].includes(type)) return res.status(400).json({error:"Please choose Chat or Call consultation."});
    if(name.length>100||email.length>160||mobile.length>20||notes.length>2000) return res.status(400).json({error:"One or more fields are too long."});
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({error:"Please enter a valid email address."});

    const bookingId = await nextBookingId();
    const ref=db.collection("smv_appointments").doc();
    const data={bookingId,customerUid:user.uid,customerEmail:user.email||email,name,email,mobile,type,preferredDate,preferredTime,notes,status:"new",paymentStatus:"not_required",bookingStatus:"requested",createdAt:FieldValue.serverTimestamp(),source:"website-appointment-form",updatedAt:FieldValue.serverTimestamp()};
    await ref.set(data);

    // Email notification is best-effort. Booking creation must not fail just because
    // the optional notification provider is unavailable.
    if(ADMIN_EMAIL && (RESEND_API_KEY || smtpTransport)){
      try {
        await sendEmail({to:ADMIN_EMAIL,replyTo:email,subject:`SMV ASTRO ${type} Booking — ${bookingId}`,text:["New SMV ASTRO Booking Request","",`Booking ID: ${bookingId}`,`Customer UID: ${user.uid}`,`Name: ${name}`,`Email: ${email}`,`Mobile: ${mobile}`,`Type: ${type}`,`Preferred: ${preferredDate} ${preferredTime}`,`Notes: ${notes||"None"}`].join("\n")});
      } catch(emailErr) { console.warn("Booking notification email failed; booking remains created:", emailErr?.message||emailErr); }
    }
    return res.json({ok:true,bookingId,appointmentId:ref.id,status:"new",bookingStatus:"requested"});
  } catch(e){console.error("Appointment booking failed:",e);return res.status(502).json({error:e?.message||"Unable to create booking right now."});}
});

app.get("/public/astrologers", async (req, res) => {
  try {
    const snap = await db.collection("smv_astrologers")
      .limit(200)
      .get();

    const approvedDocs = snap.docs.filter(d => {
      const x = d.data() || {};
      return String(x.status || "").toLowerCase() === "approved";
    });

    const astrologers = [];

    for (const d of approvedDocs) {
      const x = d.data() || {};

      let emailVerified = false;

      try {
        const authUser = await admin.auth().getUser(d.id);
        emailVerified = authUser.emailVerified === true;
      } catch (authErr) {
        console.warn(
          "Unable to check email verification for astrologer:",
          d.id,
          authErr?.message || authErr
        );
        emailVerified = false;
      }

      /*
       * PUBLIC ASTROLOGER LIST RULE:
       *
       * Admin Approved       = REQUIRED
       * Email Verified       = REQUIRED
       */
      if (!emailVerified) {
        continue;
      }

      astrologers.push({
        id: d.id,
        name: x.name || "Astrologer",
        expertise: x.expertise || x.specialization || "Astrology",
        specialization: x.specialization || x.expertise || "Astrology",
        experience: x.experience || 0,
        bio: x.bio || x.about || "",
        about: x.about || x.bio || "",
        photoData: x.photoData || x.photoURL || x.photoUrl || "",
        rating: x.rating || x.averageRating || "New",
        publicId: x.publicId || "",
        status: x.status || ""
      });
    }

    return res.json({
      success: true,
      astrologers
    });

  } catch (e) {
    console.error("Public astrologers load failed:", e);

    return res.status(500).json({
      error: e?.message || "Unable to load approved astrologers."
    });
  }
});
app.get("/public/astrologers/:astrologerId/reviews", async(req,res)=>{
  try{
    const astrologerId=String(req.params?.astrologerId||"").trim();
    if(!astrologerId) return res.status(400).json({error:"Astrologer ID is required."});
    const astroSnap=await db.collection("smv_astrologers").doc(astrologerId).get();
    if(!astroSnap.exists || String(astroSnap.data()?.status||"").toLowerCase()!=="approved") return res.status(404).json({error:"Approved astrologer not found."});
    const snap=await db.collection("smv_reviews").limit(200).get();
    const reviews=snap.docs.map(d=>({id:d.id,...d.data()})).filter(r=>r.astrologerId===astrologerId && (r.approved===true || String(r.status||"").toLowerCase()==="approved"));
    return res.json({success:true,astrologerId,reviews});
  }catch(e){console.error("Public astrologer reviews load failed:",e);return res.status(500).json({error:e?.message||"Unable to load astrologer reviews."});}
});
// ============================================================
// CUSTOMER REVIEW API
// Server-side review submission — avoids Firestore client
// permission problems and prevents duplicate reviews.
// ============================================================

app.get("/customer/reviews", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  try {
    const snap = await db.collection("smv_reviews")
      .where("customerId", "==", user.uid)
      .limit(200)
      .get();

    const reviews = snap.docs
      .map(d => ({
        id: d.id,
        questionId: String(d.data()?.questionId || "")
      }))
      .filter(x => x.questionId);

    return res.json({
      success: true,
      reviews
    });
  } catch (e) {
    console.error(
      "Customer review status load failed:",
      e?.message || e
    );

    return res.status(500).json({
      error: e?.message || "Unable to load customer review status."
    });
  }
});


app.post("/customer/submit-review", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const questionId =
    String(req.body?.questionId || "").trim();

  const astrologerId =
    String(req.body?.astrologerId || "").trim();

  const rating =
    Number(req.body?.rating);

  const review =
    String(req.body?.review || "").trim();

  try {

    if (!questionId || !astrologerId) {
      return res.status(400).json({
        error: "Consultation information is missing."
      });
    }

    if (
      !Number.isInteger(rating) ||
      rating < 1 ||
      rating > 5
    ) {
      return res.status(400).json({
        error: "Please select a rating from 1 to 5."
      });
    }

    if (!review) {
      return res.status(400).json({
        error: "Please write your review."
      });
    }

    const questionRef =
      db.collection("smv_questions").doc(questionId);

    const questionSnap =
      await questionRef.get();

    if (!questionSnap.exists) {
      return res.status(404).json({
        error: "Consultation not found."
      });
    }

    const q = questionSnap.data() || {};

    // Customer ownership check
    if (
      String(q.customerId || "") !==
      String(user.uid)
    ) {
      return res.status(403).json({
        error: "You are not allowed to review this consultation."
      });
    }

    // Review is allowed only after final answer
    if (String(q.status || "") !== "answered") {
      return res.status(409).json({
        error: "You can review only after the answer has been approved."
      });
    }

    // Astrologer check
    if (
      String(q.astrologerId || "") !==
      astrologerId
    ) {
      return res.status(409).json({
        error: "Astrologer information does not match."
      });
    }

    // One review per customer + question
    const reviewId =
      `${questionId}_${user.uid}`;

    const reviewRef =
      db.collection("smv_reviews").doc(reviewId);

    const existing =
      await reviewRef.get();

    // Already reviewed
    if (existing.exists) {

      await questionRef.set({
        reviewed: true,
        reviewSubmittedAt:
          q.reviewSubmittedAt ||
          FieldValue.serverTimestamp()
      }, {
        merge: true
      });

      return res.json({
        success: true,
        alreadySubmitted: true,
        reviewId
      });
    }

    // Create review
    await reviewRef.set({

      questionId,

      customerId: user.uid,

      customerName:
        q.customerName ||
        q.birthName ||
        "Customer",

      astrologerId,

      astrologerName:
        q.astrologerName ||
        "Astrologer",

      rating,

      review,

      verified: true,

      approved: false,

      status: "pending",

      createdAt:
        FieldValue.serverTimestamp()

    });

    // Mark consultation as reviewed
    await questionRef.set({

      reviewed: true,

      reviewSubmittedAt:
        FieldValue.serverTimestamp()

    }, {
      merge: true
    });

    return res.json({
      success: true,
      alreadySubmitted: false,
      reviewId
    });

  } catch (e) {

    console.error(
      "Customer review submission failed:",
      e?.message || e
    );

    return res.status(500).json({
      error:
        e?.message ||
        "Unable to submit review."
    });
  }
});

app.get("/admin/appointments", async(req,res)=>{
  const user=await requireUser(req,res); if(!user)return; if(!(await isAdminUser(user)))return res.status(403).json({error:"Admin access required."});
  try{
    // Avoid orderBy so an index can never block the Admin Dashboard.
    const snap=await db.collection("smv_appointments").limit(200).get();
    const appointments=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>{
      const at=a.createdAt?.toMillis?a.createdAt.toMillis():(a.createdAt?.seconds||0)*1000;
      const bt=b.createdAt?.toMillis?b.createdAt.toMillis():(b.createdAt?.seconds||0)*1000;
      return bt-at;
    }).slice(0,50);
    return res.json({appointments});
  }catch(e){return res.status(500).json({error:e?.message||"Unable to load appointments."});}
});

app.post("/admin/appointment-status", express.json({limit:"5kb"}), async(req,res)=>{
  const user=await requireUser(req,res); if(!user)return; if(!(await isAdminUser(user)))return res.status(403).json({error:"Admin access required."});
  try{const id=String(req.body?.id||"").trim(),status=String(req.body?.status||"").trim();if(!id||!["new","confirmed","completed","cancelled"].includes(status))return res.status(400).json({error:"Invalid appointment update."});await db.collection("smv_appointments").doc(id).update({status,updatedAt:FieldValue.serverTimestamp(),updatedBy:user.uid});return res.json({ok:true});}catch(e){return res.status(500).json({error:e?.message||"Unable to update appointment."});}
});

app.post("/admin/approve-question", express.json({limit:"10kb"}), async (req,res)=>{
  const user=await requireUser(req,res); if(!user)return;
  if(!(await isAdminUser(user))) return res.status(403).json({error:"Admin access denied."});
  try{
    const questionId=String(req.body?.questionId||"").trim();
    const astrologerId=String(req.body?.astrologerId||"").trim();
    const pct=Number(req.body?.commissionPercent);
    if(!questionId||!astrologerId) return res.status(400).json({error:"Question ID and astrologer are required."});
    if(!Number.isFinite(pct)||pct<0||pct>100) return res.status(400).json({error:"Commission percentage must be between 0 and 100."});
    const qRef=db.collection("smv_questions").doc(questionId);
    const aRef=db.collection("smv_astrologers").doc(astrologerId);
    const [qSnap,aSnap]=await Promise.all([qRef.get(),aRef.get()]);
    if(!qSnap.exists) return res.status(404).json({error:"Question not found."});
    if(!aSnap.exists) return res.status(404).json({error:"Astrologer not found."});
    const q=qSnap.data()||{}, a=aSnap.data()||{};
    if(String(a.status||"").toLowerCase()!=="approved") return res.status(409).json({error:"Selected astrologer is not approved."});
    if(["answered","question_rejected"].includes(String(q.status||""))) return res.status(409).json({error:"This question is already closed."});
    const amount=Number(q.amount||q.paymentAmount||0);
    if(!Number.isFinite(amount)||amount<=0) return res.status(409).json({error:"This question does not have a valid paid amount."});
    const astroCommission=Math.round(amount*pct)/100;
    const adminCommission=Math.round((amount-astroCommission)*100)/100;
    await qRef.update({
      status:"paid", allocationStatus:"assigned_to_astrologer", astrologerId, astrologerName:a.name||"Astrologer",
      commissionPercent:pct, commissionRate:pct, astrologerCommissionAmount:astroCommission,
      adminCommissionAmount:adminCommission, adminQuestionApprovedAt:FieldValue.serverTimestamp(),
      adminQuestionApprovedBy:user.uid, commissionStatus:"allocated_pending_answer", updatedAt:FieldValue.serverTimestamp()
    });
    await writeAdminAudit("QUESTION_APPROVED",questionId,user.uid,{astrologerId,commissionPercent:pct,astrologerCommissionAmount:astroCommission,adminCommissionAmount:adminCommission});
    await db.collection("smv_notifications").add({userId:astrologerId,type:"question_assigned",title:"New Question Assigned",message:"A paid question has been assigned to you by Admin.",questionId,commissionAmount:astroCommission,createdAt:FieldValue.serverTimestamp(),read:false});
    return res.json({success:true,questionId,astrologerId,commissionPercent:pct,astrologerCommissionAmount:astroCommission,adminCommissionAmount:adminCommission});
  }catch(e){console.error("Admin approve question error:",e);return res.status(500).json({error:e?.message||"Unable to approve and allocate question."});}
});


// Astrologer claim: use the trusted Admin SDK so the browser does not need
// direct Firestore write permission for the claim/status transition.
app.post("/astrologer/claim-question", express.json({limit:"10kb"}), async (req,res)=>{
  const user=await requireUser(req,res); if(!user)return;
  try{
    const questionId=String(req.body?.questionId||"").trim();
    if(!questionId) return res.status(400).json({error:"Question ID is required."});

    const qRef=db.collection("smv_questions").doc(questionId);
    const astroRef=db.collection("smv_astrologers").doc(user.uid);
    const [qSnap,astroSnap]=await Promise.all([qRef.get(),astroRef.get()]);
    if(!qSnap.exists) return res.status(404).json({error:"Question not found."});
    if(!astroSnap.exists) return res.status(403).json({error:"Astrologer profile not found."});

    const q=qSnap.data()||{};
    const astro=astroSnap.data()||{};
    if(String(astro.status||"").toLowerCase()!=="approved"){
      return res.status(403).json({error:"Your astrologer profile is not approved by Admin."});
    }
    if(String(q.astrologerId||"")!==String(user.uid)){
      return res.status(403).json({error:"This question is not allocated to your account."});
    }
    if(!q.adminQuestionApprovedAt){
      return res.status(409).json({error:"This question is still waiting for Admin approval."});
    }
    const status=String(q.status||"");
    const allocation=String(q.allocationStatus||"");
    if(["answered","question_rejected","admin_rejected"].includes(status)){
      return res.status(409).json({error:"This question is already closed."});
    }
    if(!["paid","admin_approved"].includes(status) ||
       !["assigned_to_astrologer","available_to_astrologers","reallocated","claimed_by_astrologer"].includes(allocation)){
      return res.status(409).json({error:"This question is no longer available to claim."});
    }

    if(allocation!=="claimed_by_astrologer"){
      await qRef.update({
        status:"admin_approved",
        allocationStatus:"claimed_by_astrologer",
        claimedAt:FieldValue.serverTimestamp(),
        claimedBy:user.uid,
        updatedAt:FieldValue.serverTimestamp()
      });
    }

    return res.json({success:true,questionId,astrologerId:user.uid,status:"admin_approved",allocationStatus:"claimed_by_astrologer"});
  }catch(e){
    console.error("Astrologer claim question error:",e);
    return res.status(500).json({error:e?.message||"Unable to claim this question."});
  }
});


app.post("/admin/reject-question", express.json({limit:"10kb"}), async (req,res)=>{
  const user=await requireUser(req,res); if(!user)return;
  if(!(await isAdminUser(user))) return res.status(403).json({error:"Admin access denied."});
  try{
    const questionId=String(req.body?.questionId||"").trim();
    const reason=String(req.body?.reason||"").trim();
    if(!questionId||!reason) return res.status(400).json({error:"Question ID and rejection reason are required."});
    const qRef=db.collection("smv_questions").doc(questionId);
    const qSnap=await qRef.get();
    if(!qSnap.exists) return res.status(404).json({error:"Question not found."});
    const q=qSnap.data()||{};
    const currentStatus=String(q.status||"");
    const answerSubmitted=!!String(q.answer||"").trim();
    const hasAstrologerAnswer=answerSubmitted &&
      ["processing","answer_draft","admin_review","revision_required","answered"].includes(currentStatus);
    const hasPaidQuestion=!!q.customerPaymentId || !!q.razorpayPaymentId || !!q.paymentRecordedAt || !!q.paidAt || q.paymentStatus==="paid";
    const allocatedQuestion=!!q.adminQuestionApprovedAt && !!q.astrologerId &&
      ["assigned_to_astrologer","reallocated","available_to_astrologers","claimed_by_astrologer"].includes(String(q.allocationStatus||""));
    const canRejectBeforeFinalAnswer =
      !["question_rejected","admin_rejected"].includes(currentStatus) &&
      (allocatedQuestion || hasAstrologerAnswer || (hasPaidQuestion && !q.adminQuestionApprovedAt));
    if(!canRejectBeforeFinalAnswer){
      return res.status(409).json({error:"This question can no longer be rejected and refunded."});
    }
    const amount=Number(q.amount||q.paymentAmount||0);
    const paid=!!q.customerPaymentId || !!q.razorpayPaymentId || !!q.paymentRecordedAt || !!q.paidAt || q.paymentStatus==="paid";

    // Close the question first so answer approval cannot race with the rejection/refund decision.
    const lockPatch={
      status:"question_rejected", allocationStatus:"rejected_by_admin",
      adminQuestionRejectedAt:FieldValue.serverTimestamp(), adminQuestionRejectedBy:user.uid,
      adminQuestionRejectionReason:reason, refundEligible:paid && amount>0,
      refundAmount:paid && amount>0 ? amount : 0,
      refundReason:reason, refundStatus:paid && amount>0 ? "pending" : "not_applicable",
      refundRequestedAt:paid && amount>0 ? FieldValue.serverTimestamp() : FieldValue.delete(),
      astrologerAnswerStatus:"question_rejected", commissionStatus:"refund_pending",
      astrologerCommissionAmount:0, commissionAmount:0, astrologerPaymentId:FieldValue.delete(),
      answerApprovedAt:FieldValue.delete(), adminAnswerApprovedAt:FieldValue.delete(),
      answerApprovedBy:FieldValue.delete(), commissionCreditedAt:FieldValue.delete(),
      updatedAt:FieldValue.serverTimestamp()
    };
    await qRef.update(lockPatch);
    const patch={...lockPatch};
    let refund=null;
    if(paid && amount>0 && q.razorpayPaymentId){
      if(q.refundId){
        refund={id:q.refundId,status:q.refundStatus||"pending",amount:Number(q.refundAmount||amount)};
      }else{
        try{
          refund=await razorpay.payments.refund(String(q.razorpayPaymentId), { amount:Math.round(amount*100), notes:{questionId,reason:"Admin rejected question before consultation"} });
          patch.refundId=refund.id||FieldValue.delete();
          patch.refundStatus=String(refund.status||"pending").toLowerCase();
          patch.refundAmount=refund.amount!=null?Number(refund.amount)/100:amount;
          patch.refundCreatedAt=FieldValue.serverTimestamp();
          patch.refundPaymentId=refund.payment_id||q.razorpayPaymentId;
          patch.refundRrn=refund?.acquirer_data?.rrn||refund?.acquirer_data?.bank_reference_number||refund?.acquirer_data?.reference_number||FieldValue.delete();
        }catch(refundError){
          // Keep the exact Razorpay failure details in a safe, non-secret form.
          // Never store the API secret or full request headers in Firestore.
          const razorpayError = {
            statusCode: Number(refundError?.statusCode || refundError?.status || 0) || null,
            code: String(refundError?.error?.code || refundError?.code || "").trim() || null,
            description: String(refundError?.error?.description || refundError?.description || refundError?.message || "Unable to create Razorpay refund.").trim(),
            reason: String(refundError?.error?.reason || refundError?.reason || "").trim() || null,
            source: String(refundError?.error?.source || refundError?.source || "").trim() || null,
            step: String(refundError?.error?.step || refundError?.step || "").trim() || null
          };
          console.error("[REFUND_TRACE] Razorpay refund creation failed", {
            questionId, razorpayPaymentId: String(q.razorpayPaymentId || ""),
            amount: Math.round(amount * 100), razorpayError
          });
          patch.refundStatus="failed";
          patch.refundError=razorpayError.description;
          patch.refundErrorCode=razorpayError.code || FieldValue.delete();
          patch.refundErrorStatusCode=razorpayError.statusCode || FieldValue.delete();
          patch.refundErrorReason=razorpayError.reason || FieldValue.delete();
          patch.refundErrorSource=razorpayError.source || FieldValue.delete();
          patch.refundErrorStep=razorpayError.step || FieldValue.delete();
          patch.refundLastAttemptAt=FieldValue.serverTimestamp();
        }
      }
    }
    await qRef.update(patch);
    // Keep the rejection/refund result independent of audit logging.
    // The answerSubmitted flag is explicitly defined above and is also copied
    // into this local payload so an older deployed bundle cannot hit an
    // undeclared-variable error at this point.
    const rejectionAudit={reason,previousStatus:currentStatus,answerSubmitted:!!answerSubmitted,refundId:refund?.id||null,refundStatus:patch.refundStatus||null,refundAmount:patch.refundAmount||0};
    await db.collection("smv_notifications").add({userId:q.customerId,type:"question_rejected",title:"Question Rejected — Refund",message:`Your paid question was rejected by Admin. Reason: ${reason}${patch.refundStatus!=="not_applicable"?` Refund status: ${patch.refundStatus}.`:""}`,questionId,refundStatus:patch.refundStatus||null,refundId:refund?.id||null,createdAt:FieldValue.serverTimestamp(),read:false});
    if(q.astrologerId){
      await db.collection("smv_notifications").add({userId:String(q.astrologerId),type:"question_rejected",title:"Question Rejected by Admin",message:`This question has been rejected by Admin and is no longer available. The customer payment is being refunded. Reason: ${reason}`,questionId,refundStatus:patch.refundStatus||null,refundId:refund?.id||null,createdAt:FieldValue.serverTimestamp(),read:false});
    }
    await writeAdminAudit("QUESTION_REJECTED",questionId,user.uid,rejectionAudit);
    try{
      const approvedAstros=await db.collection("smv_astrologers").where("status","==","approved").get();
      const batch=db.batch();
      approvedAstros.docs.forEach(a=>{
        if(a.id===String(q.astrologerId||"")) return;
        batch.set(db.collection("smv_notifications").doc(),{
          userId:a.id,type:"question_rejected_broadcast",title:"Question Closed by Admin",
          message:"A paid customer question has been permanently rejected and refunded by Admin. It is no longer available for answering.",
          questionId,createdAt:FieldValue.serverTimestamp(),read:false
        });
      });
      if(!approvedAstros.empty) await batch.commit();
    }catch(notificationError){ console.warn("Reject-question broadcast notification failed:",notificationError?.message||notificationError); }
    return res.json({success:true,questionId,refundId:refund?.id||q.refundId||null,refundStatus:patch.refundStatus||"not_applicable",refundAmount:Number(patch.refundAmount||amount||0),refundCreated:!!refund});
  }catch(e){console.error("Admin reject question error:",e);return res.status(500).json({error:e?.message||"Unable to reject question and process refund."});}
});

// Admin-only diagnostic endpoint. It does NOT create a refund.
// It verifies that the rejected question contains the real Razorpay payment ID
// and, when a refund ID exists, reads that refund from Razorpay. Exact API error
// fields are returned without exposing credentials or request headers.
app.get("/admin/refund-trace/:questionId", async (req,res)=>{
  const user=await requireUser(req,res); if(!user)return;
  if(!(await isAdminUser(user))) return res.status(403).json({error:"Admin access denied."});
  try{
    const questionId=String(req.params.questionId||"").trim();
    if(!questionId) return res.status(400).json({error:"Question ID is required."});
    const qSnap=await db.collection("smv_questions").doc(questionId).get();
    if(!qSnap.exists) return res.status(404).json({error:"Question not found."});
    const q=qSnap.data()||{};
    const paymentId=String(q.razorpayPaymentId||"").trim();
    const result={
      questionId,
      questionStatus:String(q.status||""),
      paymentStatus:String(q.paymentStatus||""),
      customerPaymentId:String(q.customerPaymentId||""),
      razorpayPaymentId:paymentId||null,
      refundStatus:String(q.refundStatus||""),
      refundId:String(q.refundId||""),
      refundAmount:Number(q.refundAmount||q.amount||0),
      storedRefundError:String(q.refundError||"")||null,
      storedRefundErrorCode:String(q.refundErrorCode||"")||null,
      storedRefundErrorStatusCode:Number(q.refundErrorStatusCode||0)||null,
      storedRefundErrorReason:String(q.refundErrorReason||"")||null,
      storedRefundErrorSource:String(q.refundErrorSource||"")||null,
      storedRefundErrorStep:String(q.refundErrorStep||"")||null
    };
    if(!paymentId){
      return res.json({...result,paymentLookup:"not_available",diagnosis:"No razorpayPaymentId is stored on this question."});
    }
    try{
      const payment=await razorpay.payments.fetch(paymentId);
      result.paymentLookup={id:payment?.id||paymentId,status:payment?.status||null,amount:payment?.amount!=null?Number(payment.amount)/100:null,currency:payment?.currency||null,orderId:payment?.order_id||null};
    }catch(e){
      const err={statusCode:Number(e?.statusCode||e?.status||0)||null,code:String(e?.error?.code||e?.code||"").trim()||null,description:String(e?.error?.description||e?.description||e?.message||"Razorpay payment lookup failed.").trim(),reason:String(e?.error?.reason||e?.reason||"").trim()||null,source:String(e?.error?.source||e?.source||"").trim()||null,step:String(e?.error?.step||e?.step||"").trim()||null};
      console.error("[REFUND_TRACE] Payment lookup failed",{questionId,razorpayPaymentId:paymentId,error:err});
      return res.status(502).json({...result,paymentLookupError:err});
    }
    if(result.refundId){
      try{
        const refund=await razorpay.refunds.fetch(result.refundId);
        result.refundLookup={id:refund?.id||result.refundId,status:refund?.status||null,amount:refund?.amount!=null?Number(refund.amount)/100:null,paymentId:refund?.payment_id||null,createdAt:refund?.created_at||null};
      }catch(e){
        const err={statusCode:Number(e?.statusCode||e?.status||0)||null,code:String(e?.error?.code||e?.code||"").trim()||null,description:String(e?.error?.description||e?.description||e?.message||"Razorpay refund lookup failed.").trim(),reason:String(e?.error?.reason||e?.reason||"").trim()||null,source:String(e?.error?.source||e?.source||"").trim()||null,step:String(e?.error?.step||e?.step||"").trim()||null};
        console.error("[REFUND_TRACE] Refund lookup failed",{questionId,refundId:result.refundId,error:err});
        result.refundLookupError=err;
      }
    }
    result.diagnosis=result.refundId?"A Razorpay refund ID is stored; inspect refundLookup/status.":(String(q.refundStatus||"").toLowerCase()==="failed"?"No refund ID was created. Inspect stored refund error and paymentLookup; the refund API did not create a Razorpay refund.":"Payment ID is present and available for refund processing.");
    return res.json(result);
  }catch(e){
    console.error("[REFUND_TRACE] Diagnostic endpoint failed:",e);
    return res.status(500).json({error:e?.message||"Refund trace failed."});
  }
});

// Customer/Admin can explicitly reconcile a Razorpay refund. This is a safe
// fallback when the Razorpay webhook is delayed or not configured yet.
app.post("/customer/sync-refund", express.json({limit:"10kb"}), async (req,res)=>{
  const user=await requireUser(req,res); if(!user)return;
  try{
    const questionId=String(req.body?.questionId||"").trim();
    if(!questionId) return res.status(400).json({error:"Question ID is required."});
    const qRef=db.collection("smv_questions").doc(questionId);
    const qSnap=await qRef.get();
    if(!qSnap.exists) return res.status(404).json({error:"Question not found."});
    const q=qSnap.data()||{};
    const isAdmin=await isAdminUser(user);
    if(!isAdmin && String(q.customerId||"")!==String(user.uid||"")) return res.status(403).json({error:"Access denied."});
    if(!["question_rejected","admin_rejected"].includes(String(q.status||""))) return res.status(409).json({error:"This question does not have a refund."});
    if(!q.refundId) return res.json({success:true,refundStatus:String(q.refundStatus||"pending"),refundId:null,refundAmount:Number(q.refundAmount||q.amount||0),synced:false});

    const refund=await razorpay.refunds.fetch(String(q.refundId));
    const status=String(refund?.status||q.refundStatus||"pending").toLowerCase();
    const amount=refund?.amount!=null?Number(refund.amount)/100:Number(q.refundAmount||q.amount||0);
    const resolvedRrn=refund?.acquirer_data?.rrn||refund?.acquirer_data?.bank_reference_number||refund?.acquirer_data?.reference_number||refund?.rrn||q.refundRrn||null;
    const patch={refundId:refund?.id||q.refundId,refundPaymentId:refund?.payment_id||q.refundPaymentId||q.razorpayPaymentId,refundAmount:amount,refundStatus:status,refundRrn:resolvedRrn||FieldValue.delete(),updatedAt:FieldValue.serverTimestamp()};
    if(status==="processed"||status==="completed") patch.refundProcessedAt=FieldValue.serverTimestamp();
    if(status==="failed") patch.refundFailedAt=FieldValue.serverTimestamp();
    await qRef.set(patch,{merge:true});
    return res.json({success:true,refundStatus:status,refundId:patch.refundId,refundAmount:amount,refundRrn:resolvedRrn,refundProcessed:status==="processed"||status==="completed"});
  }catch(e){
    console.error("Refund status sync failed:",e);
    return res.status(502).json({error:e?.error?.description||e?.description||e?.message||"Unable to sync refund status from Razorpay."});
  }
});

app.post("/admin/sync-refund", express.json({limit:"10kb"}), async (req,res)=>{
  const user=await requireUser(req,res); if(!user)return;
  if(!(await isAdminUser(user))) return res.status(403).json({error:"Admin access denied."});
  try{
    const questionId=String(req.body?.questionId||"").trim();
    if(!questionId) return res.status(400).json({error:"Question ID is required."});
    const qRef=db.collection("smv_questions").doc(questionId); const qSnap=await qRef.get();
    if(!qSnap.exists) return res.status(404).json({error:"Question not found."});
    const q=qSnap.data()||{};
    if(!q.refundId) return res.status(409).json({error:"No Razorpay refund ID is stored for this question. If the refund failed to create, review the refund error and payment ID."});
    const refund=await razorpay.refunds.fetch(String(q.refundId));
    const status=String(refund?.status||q.refundStatus||"pending").toLowerCase();
    const amount=refund?.amount!=null?Number(refund.amount)/100:Number(q.refundAmount||q.amount||0);
    const patch={refundId:refund?.id||q.refundId,refundPaymentId:refund?.payment_id||q.refundPaymentId||q.razorpayPaymentId,refundAmount:amount,refundStatus:status,updatedAt:FieldValue.serverTimestamp()};
    if(status==="processed"||status==="completed") patch.refundProcessedAt=FieldValue.serverTimestamp();
    if(status==="failed") patch.refundFailedAt=FieldValue.serverTimestamp();
    await qRef.set(patch,{merge:true});
    await writeAdminAudit("REFUND_STATUS_SYNCED",questionId,user.uid,{refundId:patch.refundId,refundStatus:status,refundAmount:amount});
    return res.json({success:true,refundStatus:status,refundId:patch.refundId,refundAmount:amount});
  }catch(e){
    console.error("Admin refund status sync failed:",e);
    return res.status(502).json({error:e?.error?.description||e?.description||e?.message||"Unable to sync refund status from Razorpay."});
  }
});

app.post("/admin/reallocate-question", express.json({limit:"10kb"}), async (req,res)=>{
  const user=await requireUser(req,res); if(!user)return;
  if(!(await isAdminUser(user))) return res.status(403).json({error:"Admin access denied."});
  try{
    const questionId=String(req.body?.questionId||"").trim();
    const astrologerId=String(req.body?.astrologerId||"").trim();
    const pct=Number(req.body?.commissionPercent);
    if(!questionId||!astrologerId) return res.status(400).json({error:"Question ID and astrologer are required."});
    if(!Number.isFinite(pct)||pct<0||pct>100) return res.status(400).json({error:"Commission percentage must be between 0 and 100."});
    const qRef=db.collection("smv_questions").doc(questionId);
    const aRef=db.collection("smv_astrologers").doc(astrologerId);
    const [qSnap,aSnap]=await Promise.all([qRef.get(),aRef.get()]);
    if(!qSnap.exists) return res.status(404).json({error:"Question not found."});
    if(!aSnap.exists) return res.status(404).json({error:"Astrologer not found."});
    const q=qSnap.data()||{}, a=aSnap.data()||{};
    if(String(a.status||"").toLowerCase()!=="approved") return res.status(409).json({error:"Selected astrologer is not approved."});
    if(["answered","question_rejected","admin_rejected"].includes(String(q.status||""))) return res.status(409).json({error:"This question is already closed."});
    if(!q.adminQuestionApprovedAt || !q.astrologerId) return res.status(409).json({error:"This question has not been allocated yet."});
    const amount=Number(q.amount||q.paymentAmount||0);
    const astroCommission=Math.round(amount*pct)/100;
    const adminCommission=Math.round((amount-astroCommission)*100)/100;
    const oldAstrologerId=String(q.astrologerId||"");
    await qRef.update({
      astrologerId, astrologerName:a.name||"Astrologer", commissionPercent:pct, commissionRate:pct,
      astrologerCommissionAmount:astroCommission, adminCommissionAmount:adminCommission,
      allocationStatus:"assigned_to_astrologer", commissionStatus:"allocated_pending_answer",
      astrologerAnswerStatus:"pending", status:"admin_approved",
      answer:"", answerWordCount:0, answerAuthorType:"", adminTakeover:false,
      adminRejectionReason:FieldValue.delete(), adminRejectedAt:FieldValue.delete(), adminRejectedBy:FieldValue.delete(),
      reallocatedAt:FieldValue.serverTimestamp(), reallocatedBy:user.uid, updatedAt:FieldValue.serverTimestamp()
    });
    if(oldAstrologerId && oldAstrologerId!==astrologerId){
      await db.collection("smv_notifications").add({userId:oldAstrologerId,type:"question_reallocated",title:"Question Re-allocated",message:"Admin has re-allocated this question to another astrologer. It is no longer assigned to you.",questionId,createdAt:FieldValue.serverTimestamp(),read:false});
    }
    await db.collection("smv_notifications").add({userId:astrologerId,type:"question_assigned",title:"Question Re-allocated",message:"Admin has assigned a paid question to you. Please submit your answer.",questionId,commissionAmount:astroCommission,createdAt:FieldValue.serverTimestamp(),read:false});
    return res.json({success:true,questionId,astrologerId,commissionPercent:pct,astrologerCommissionAmount:astroCommission,adminCommissionAmount:adminCommission});
  }catch(e){console.error("Admin reallocate question error:",e);return res.status(500).json({error:e?.message||"Unable to re-allocate question."});}
});


app.post("/admin/edit-question", express.json({limit:"20kb"}), async (req,res)=>{
  const user=await requireUser(req,res); if(!user)return;
  if(!(await isAdminUser(user))) return res.status(403).json({error:"Admin access denied."});
  try{
    const questionId=String(req.body?.questionId||"").trim();
    const question=String(req.body?.question||"").trim();
    if(!questionId||!question) return res.status(400).json({error:"Question ID and question text are required."});
    if(question.length>10000) return res.status(400).json({error:"Question is too long."});
    const ref=db.collection("smv_questions").doc(questionId);
    const snap=await ref.get(); if(!snap.exists) return res.status(404).json({error:"Question not found."});
    const q=snap.data()||{};
    if(["answered","question_rejected"].includes(q.status)) return res.status(409).json({error:"This question can no longer be edited."});
    await ref.update({question,adminQuestionEditedAt:FieldValue.serverTimestamp(),adminQuestionEditedBy:user.uid});
    return res.json({success:true,questionId});
  }catch(e){console.error("Admin edit question error:",e);return res.status(500).json({error:e?.message||"Unable to edit question."});}
});

app.post("/admin/takeover-answer", express.json({limit:"30kb"}), async (req,res)=>{
  const user=await requireUser(req,res); if(!user)return;
  if(!(await isAdminUser(user))) return res.status(403).json({error:"Admin access denied."});
  try{
    const questionId=String(req.body?.questionId||"").trim();
    const answer=String(req.body?.answer||"").trim();
    if(!questionId||!answer) return res.status(400).json({error:"Question ID and Admin answer are required."});
    const ref=db.collection("smv_questions").doc(questionId);
    const snap=await ref.get(); if(!snap.exists) return res.status(404).json({error:"Question not found."});
    const q=snap.data()||{};
    if(!q.customerId) return res.status(409).json({error:"Customer information is missing."});
    if(["answered","question_rejected"].includes(q.status)) return res.status(409).json({error:"This question is already closed."});
    const wordCount=answer.split(/\s+/).filter(Boolean).length;
    const minWords=Math.max(1,Number(q.answerMinWords||1));
    if(wordCount<minWords) return res.status(400).json({error:`Admin answer must contain at least ${minWords} words.`});
    // Translate the Admin answer to Tamil before saving it for the Tamil website.
    const translatedAnswer=await translateAnswerToTamil(answer);
    const translatedWordCount=translatedAnswer.split(/\s+/).filter(Boolean).length;
    await ref.update({
      question: q.question || "",
      answer:translatedAnswer,
      answerWordCount:translatedWordCount,
      answerAuthorType:"admin",
      adminAnswered:true,
      adminAnswerBy:user.uid,
      adminAnswerAt:FieldValue.serverTimestamp(),
      status:"answered",
      astrologerAnswerStatus:"not_required",
      commissionStatus:"admin_retained",
      astrologerCommissionAmount:0,
      commissionAmount:0,
      commissionCreditedAt:FieldValue.delete(),
      astrologerPaymentId:FieldValue.delete(),
      adminTakeover:true,
      answeredAt:FieldValue.serverTimestamp(),
      updatedAt:FieldValue.serverTimestamp()
    });
    await db.collection("smv_notifications").add({userId:q.customerId,type:"answer_approved",title:"Your astrology answer is ready",message:"SMV ASTRO Admin answered your question directly.",questionId,createdAt:FieldValue.serverTimestamp(),read:false});
    return res.json({success:true,questionId,answerAuthorType:"admin",adminRetained:true});
  }catch(e){console.error("Admin takeover answer error:",e);return res.status(500).json({error:e?.message||"Unable to save Admin answer."});}
});

app.post("/astrologer/change-payout", express.json({limit:"10kb"}), async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  try {
    const userSnap = await db.collection("smv_users").doc(user.uid).get();
    const astroSnap = await db.collection("smv_astrologers").doc(user.uid).get();
    const role = String(userSnap.data()?.role || "").toLowerCase();
    const astro = astroSnap.data() || {};
    if (role !== "astrologer" || astro.status !== "approved") return res.status(403).json({error:"Only an approved Astrologer can change the payment method."});
    const bankName=String(req.body?.bankName||"").trim();
    const accountName=String(req.body?.accountName||"").trim();
    const accountNumber=String(req.body?.accountNumber||"").trim();
    const ifsc=String(req.body?.ifsc||"").trim().toUpperCase();
    const upi=String(req.body?.upi||"").trim();
    if(!bankName||!accountName||!accountNumber||!ifsc) return res.status(400).json({error:"Please complete all required payment details."});
    if(bankName.length>120||accountName.length>120||accountNumber.length>40||ifsc.length>20||upi.length>120) return res.status(400).json({error:"Payment details are too long."});
    if(accountNumber.length<6) return res.status(400).json({error:"Enter a valid account number."});
    if(ifsc.length<4) return res.status(400).json({error:"Enter a valid IFSC code."});
    const payoutRef=db.collection("smv_payouts").doc(user.uid);
    await payoutRef.set({uid:user.uid,bankName,accountName,accountNumber,ifsc,upi,status:"pending_admin_review",requestedAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp(),approvedAt:FieldValue.delete(),rejectedAt:FieldValue.delete(),rejectionReason:FieldValue.delete()},{merge:true});
    await db.collection("smv_notifications").add({userId:user.uid,type:"payment_method",title:"Payment Method Submitted",message:"Your new payment method is waiting for Admin approval.",createdAt:FieldValue.serverTimestamp(),read:false});
    await db.collection("smv_notifications").add({userId:ADMIN_UID,type:"payment_method_review",title:"Astrologer Payment Method Approval Required",message:`Astrologer ${astro.name||user.uid} submitted a new payment method for Admin approval.`,astrologerId:user.uid,createdAt:FieldValue.serverTimestamp(),read:false});
    return res.json({success:true,status:"pending_admin_review"});
  } catch(e){
    console.error("Astrologer payout change error:",e);
    return res.status(500).json({error:"Unable to submit payment method change right now. Please try again."});
  }
});

app.post("/admin/payout-change-status", express.json({limit:"5kb"}), async (req,res)=>{
  const user=await requireUser(req,res); if(!user) return;
  if(!(await isAdminUser(user))) return res.status(403).json({error:"Admin access denied."});
  try{
    const astrologerId=String(req.body?.astrologerId||"").trim();
    const status=String(req.body?.status||"").trim();
    const reason=String(req.body?.reason||"").trim();
    if(!astrologerId||!["approved","rejected"].includes(status)) return res.status(400).json({error:"Invalid payment method approval request."});
    const payoutRef=db.collection("smv_payouts").doc(astrologerId), snap=await payoutRef.get();
    if(!snap.exists) return res.status(404).json({error:"Payment method request not found."});
    const p=snap.data()||{};
    if(String(p.status||"")!=="pending_admin_review") return res.status(400).json({error:"This payment method request is no longer pending."});
    if(status==="rejected"&&!reason) return res.status(400).json({error:"Enter a rejection reason."});
    const patch={status,reviewedAt:FieldValue.serverTimestamp(),reviewedBy:user.uid,updatedAt:FieldValue.serverTimestamp()};
    if(status==="approved") patch.approvedAt=FieldValue.serverTimestamp();
    else { patch.rejectedAt=FieldValue.serverTimestamp(); patch.rejectionReason=reason; }
    await payoutRef.update(patch);
    await db.collection("smv_notifications").add({userId:astrologerId,type:"payment_method",title:status==="approved"?"Payment Method Approved":"Payment Method Rejected",message:status==="approved"?"Your new payment method has been approved by Admin.":`Your new payment method was rejected by Admin. Reason: ${reason}`,createdAt:FieldValue.serverTimestamp(),read:false});
    await writeAdminAudit("PAYMENT_METHOD_"+status.toUpperCase(), astrologerId, user.uid, {astrologerId});
    return res.json({success:true,status});
  }catch(e){console.error("Admin payout status error:",e);return res.status(500).json({error:"Unable to update payment method approval."});}
});

app.get("/admin-data", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (!(await isAdminUser(user))) return res.status(403).json({ error: "Admin access denied." });

  const readCollection = async (name) => {
    try {
      const snap = await db.collection(name).get();
      return { ok: true, items: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
    } catch (e) {
      console.error(`Admin collection ${name} failed:`, e?.message || e);
      return { ok: false, items: [], error: e?.message || `Unable to read ${name}.` };
    }
  };

  try {
    // Read each collection independently. One damaged/missing collection must
    // never prevent the Admin Dashboard itself from opening.
    const [users, astrologers, questions, payments] = await Promise.all([
      readCollection("smv_users"),
      readCollection("smv_astrologers"),
      readCollection("smv_questions"),
      readCollection("smv_payments")
    ]);

    const customers = users.items.filter(x => String(x.role || "").toLowerCase() === "customer");
    return res.json({
      success: true,
      customers,
      users: users.items,
      astrologers: astrologers.items,
      questions: questions.items,
      payments: payments.items,
      errors: { users: users.error || null, astrologers: astrologers.error || null, questions: questions.error || null, payments: payments.error || null }
    });
  } catch (e) {
    console.error("Admin data load failed:", e);
    return res.status(500).json({ error: e?.message || "Unable to load Admin data." });
  }
});

app.post("/create-order", express.json(), async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  try {
    let questionId = String(req.body?.questionId || "").trim();
    let qRef;
    let q;
    if (!questionId) questionId = await nextQuestionId();

    // Create/read the question on the trusted server. The browser no longer calls
    // Firestore to create the question document, which eliminates the empty
    // documentPath error seen before Razorpay opened.
    if (questionId) {
      if (questionId.includes("/") || questionId === "." || questionId === "..") {
        return res.status(400).json({ error: "A valid questionId is required." });
      }
      qRef = db.collection("smv_questions").doc(questionId);
      const qSnap = await qRef.get();
      if (!qSnap.exists) {
        const settingSnap = await db.collection("smv_settings").doc("question").get();
        const configuredPrice = Number(settingSnap.data()?.price || 5);
        const birth = req.body?.birthDetails || {};
        const customerName = String(req.body?.customerName || birth.name || "").trim();
        const questionText = String(req.body?.question || "").trim();
        if (!customerName || !questionText || !birth.birthDate || !birth.birthTime || !String(birth.birthPlace || "").trim()) {
          return res.status(400).json({ error: "Complete customer birth details and question are required." });
        }
        q = {
          customerId: user.uid, questionId, customerName, birthName: customerName, question: questionText,
          amount: configuredPrice, status: "awaiting_payment", paymentStatus: "pending",
          allocationStatus: "awaiting_admin",
          birthDetails: {
            name: customerName, birthDate: String(birth.birthDate), birthTime: String(birth.birthTime),
            birthPlace: String(birth.birthPlace).trim(), birthGender: String(birth.birthGender || ""),
            timezone: "Asia/Kolkata", utcOffsetMinutes: 330
          },
          birthDate: String(birth.birthDate), birthTime: String(birth.birthTime),
          birthPlace: String(birth.birthPlace).trim(), birthGender: String(birth.birthGender || ""),
          birthTimezone: "Asia/Kolkata", birthUtcOffsetMinutes: 330,
          createdAt: FieldValue.serverTimestamp()
        };
        await qRef.set(q);
      } else {
        q = qSnap.data();
        if (q.customerId !== user.uid) return res.status(403).json({ error: "You do not own this question." });
        if (String(q.questionId || "") !== questionId) {
          await qRef.set({ questionId }, { merge: true });
          q = { ...q, questionId };
        }
        // Preserve India wall-clock birth time. Never reinterpret a user-entered
        // HH:mm value as UTC and shift it by 5:30 hours.
        if (!q.birthTimezone || !q.birthUtcOffsetMinutes || !q.birthDetails?.timezone) {
          await qRef.set({
            birthTimezone: q.birthTimezone || "Asia/Kolkata",
            birthUtcOffsetMinutes: Number(q.birthUtcOffsetMinutes ?? 330),
            birthDetails: {
              ...(q.birthDetails || {}),
              timezone: q.birthDetails?.timezone || "Asia/Kolkata",
              utcOffsetMinutes: Number(q.birthDetails?.utcOffsetMinutes ?? 330)
            }
          }, { merge: true });
          q = {
            ...q,
            birthTimezone: q.birthTimezone || "Asia/Kolkata",
            birthUtcOffsetMinutes: Number(q.birthUtcOffsetMinutes ?? 330),
            birthDetails: {
              ...(q.birthDetails || {}),
              timezone: q.birthDetails?.timezone || "Asia/Kolkata",
              utcOffsetMinutes: Number(q.birthDetails?.utcOffsetMinutes ?? 330)
            }
          };
        }
      }
    } else {
      qRef = db.collection("smv_questions").doc();
      questionId = qRef.id;
      if (!questionId) return res.status(500).json({ error: "Unable to create a valid question ID." });

      const settingSnap = await db.collection("smv_settings").doc("question").get();
      const configuredPrice = Number(settingSnap.data()?.price || 5);
      if (!Number.isFinite(configuredPrice) || configuredPrice < 1) {
        return res.status(409).json({ error: "Question price is not configured correctly by Admin." });
      }

      const birth = req.body?.birthDetails || {};
      const customerName = String(req.body?.customerName || birth.name || "").trim();
      const questionText = String(req.body?.question || "").trim();
      if (!customerName || !questionText || !birth.birthDate || !birth.birthTime || !String(birth.birthPlace || "").trim()) {
        return res.status(400).json({ error: "Complete customer birth details and question are required." });
      }

      q = {
        customerId: user.uid,
        questionId,
        customerName,
        birthName: customerName,
        question: questionText,
        amount: configuredPrice,
        status: "awaiting_payment",
        paymentStatus: "pending",
        allocationStatus: "awaiting_admin",
        birthDetails: {
          name: customerName,
          birthDate: String(birth.birthDate),
          birthTime: String(birth.birthTime),
          birthPlace: String(birth.birthPlace).trim(),
          birthGender: String(birth.birthGender || "")
        },
        birthDate: String(birth.birthDate),
        birthTime: String(birth.birthTime),
        birthPlace: String(birth.birthPlace).trim(),
        birthGender: String(birth.birthGender || ""),
        birthTimezone: "Asia/Kolkata",
        birthUtcOffsetMinutes: 330,
        createdAt: FieldValue.serverTimestamp()
      };
      await qRef.set(q);
    }

    if (!q || q.customerId !== user.uid) return res.status(403).json({ error: "You do not own this question." });
    console.log("[create-order] questionId=", questionId, "customer=", user.uid);

    if (!["awaiting_payment", "payment_failed"].includes(q.status)) {
      if (q.paymentStatus === "paid" && q.razorpayOrderId) {
        return res.status(200).json({
          success: true, alreadyPaid: true, questionId,
          orderId: q.razorpayOrderId, keyId: RAZORPAY_KEY_ID,
          amount: Math.round(Number(q.amount || 0) * 100), currency: "INR"
        });
      }
      return res.status(409).json({ error: "This question is not available for payment." });
    }

    // IMPORTANT: For an existing unpaid/failed question, always retry at the
    // amount already locked on that question. Admin may have changed the
    // current public question price after this question was created; that
    // must NOT invalidate the customer's original question or force a new one.
    // For a brand-new question, its amount was already created from the
    // current Admin-configured price above.
    const amount = Number(q.amount || 0);
    if (!Number.isFinite(amount) || amount < 1) {
      return res.status(409).json({ error: "The original question price is unavailable. Please contact Admin." });
    }

    if (q.razorpayOrderId && ["order_created", "verification_failed", "failed"].includes(q.paymentStatus)) {
      try {
        const existing = await razorpay.orders.fetch(q.razorpayOrderId);
        if (existing.status === "paid") return res.status(409).json({ error: "This payment has already been completed. Please refresh your dashboard." });
        if (Number(existing.amount) === Math.round(amount * 100) && existing.currency === "INR") {
          return res.json({ success: true, questionId, orderId: existing.id, keyId: RAZORPAY_KEY_ID, amount: existing.amount, currency: existing.currency, reused: true });
        }
      } catch (e) { console.warn("Could not reuse old order:", e?.message || e); }
    }

    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100), currency: "INR",
      receipt: `SMV_${questionId.slice(0, 25)}_${Date.now()}`,
      notes: { questionId, customerId: user.uid, astrologerId: String(q.astrologerId || "") }
    });
    if (!order || !order.id || typeof order.id !== "string") {
      console.error("Razorpay returned an order without a valid order ID", order);
      return res.status(502).json({ error: "Razorpay order was created without a valid order ID." });
    }

    const answerSettings = await db.collection("smv_settings").doc("answer").get();
    const minimumWords = Math.max(1, Math.min(10000, Math.floor(Number(answerSettings.data()?.minimumWords || 150))));
    await qRef.set({ razorpayOrderId: order.id, paymentCurrency: "INR", paymentStatus: "order_created", answerMinWords: minimumWords, paymentUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await db.collection("razorpay_orders").doc(order.id).set({
      razorpayOrderId: order.id, questionId, amount: order.amount, currency: order.currency,
      firebaseUid: user.uid, customerEmail: user.email || null, astrologerId: String(q.astrologerId || ""),
      serviceName: req.body?.serviceName || "Public Astrology Question", status: "created", createdAt: FieldValue.serverTimestamp()
    });
    return res.json({ success: true, questionId, orderId: order.id, keyId: RAZORPAY_KEY_ID, amount: order.amount, currency: order.currency });
  } catch (e) {
    console.error("Create order error:", e);
    return res.status(500).json({ error: e?.error?.description || e?.description || e?.message || "Unable to create Razorpay order" });
  }
});

async function markQuestionPaid(questionId, orderId, paymentId, signature, source) {
  const qRef = db.collection("smv_questions").doc(questionId);
  const result = await db.runTransaction(async tx => {
    const snap = await tx.get(qRef);
    if (!snap.exists) throw new Error("Question not found.");
    const q = snap.data();
    if (q.razorpayOrderId !== orderId) throw new Error("Order mismatch.");
    if (q.paymentStatus === "paid" && q.razorpayPaymentId === paymentId) return { already: true, customerId: q.customerId, customerPaymentId: q.customerPaymentId || null };
    const amount = Number(q.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Invalid question amount.");
    const paymentDateKey = indiaDateKey();
    const paymentCounterRef = db.collection("smv_counters").doc(`payment_${paymentDateKey}`);
    const paymentCounterSnap = await tx.get(paymentCounterRef);
    const paymentInfo = nextPaymentIdInTransaction(paymentDateKey, paymentCounterSnap);
    tx.set(paymentCounterRef, { lastNumber: paymentInfo.next, dateKey: paymentDateKey, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    const customerPaymentId = paymentInfo.id;
    const paymentRecordedAt = new Date().toISOString();
    tx.set(db.collection("smv_payments").doc(customerPaymentId), {
      paymentId: customerPaymentId, type: "customer_payment", customerId: q.customerId, astrologerId: null, questionId, bookingId: q.bookingId || null,
      razorpayOrderId: orderId, razorpayPaymentId: paymentId, amount, status: "paid", paymentStatus: "paid", source, createdAt: FieldValue.serverTimestamp(), paymentRecordedAt, updatedAt: FieldValue.serverTimestamp()
    });
    tx.update(qRef, {
      status: "pending_admin_approval", paymentStatus: "paid", allocationStatus: "awaiting_admin", razorpayPaymentId: paymentId, razorpaySignature: signature,
      paidAt: q.paidAt || FieldValue.serverTimestamp(), paymentUpdatedAt: FieldValue.serverTimestamp(), paymentConfirmedBy: source, customerPaymentId, paymentRecordedAt,
      astrologerPaymentId: FieldValue.delete(), commissionStatus: "awaiting_admin_allocation"
    });
    return { already: false, customerId: q.customerId, customerPaymentId, paymentRecordedAt };
  });
  if (!result.already) {
    await db.collection("smv_notifications").add({ userId: result.customerId, type: "payment", title: "Payment successful", message: `Your payment was verified. Your question is now waiting for Admin approval. Payment ID: ${result.customerPaymentId || "N/A"}.`, paymentId: result.customerPaymentId || null, razorpayPaymentId: paymentId || null, questionId, createdAt: FieldValue.serverTimestamp(), read: false });
    const qSnap = await qRef.get();
    const q = qSnap.exists ? (qSnap.data() || {}) : {};
    const customerEmail = String(q.customerEmail || await getUserEmail(result.customerId) || "").trim();
    const amount = Number(q.amount || 0);
    await sendSystemEmail({
      to: [customerEmail, ADMIN_EMAIL],
      subject: "SMV ASTRO — Payment Successful",
      replyTo: ADMIN_EMAIL,
      text: `Payment successful for SMV ASTRO.\n\nQuestion ID: ${questionId}\nCustomer Payment ID: ${result.customerPaymentId || "N/A"}\nAmount: ₹${amount.toFixed(2)}\nRazorpay Payment ID: ${paymentId}\nRazorpay Order ID: ${orderId}\n\nYour question is now waiting for Admin approval.`
    });
    await sendAdminTransactionEmail({ eventType: "PAYMENT SUCCESS", paymentId, orderId, amount, currency: "INR", questionId, customerEmail, status: "paid" });
  }
  return result;
}


app.post("/admin/credit-commission", async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  if (!(await isAdminUser(user))) return res.status(403).json({ error: "Admin access denied." });
  try {
    const questionId = String(req.body?.questionId || "").trim(); if (!questionId) return res.status(400).json({ error: "Question ID is required." });
    const qRef = db.collection("smv_questions").doc(questionId);
    const qSnap = await qRef.get(); if (!qSnap.exists) return res.status(404).json({ error: "Question not found." });
    const q = qSnap.data() || {};
    if (!q.astrologerId) return res.status(400).json({ error: "Astrologer is not assigned." });
    const amount = Number(q.astrologerCommissionAmount || q.commissionAmount || 0);
    if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: "Invalid astrologer commission amount." });
    if (q.astrologerPaymentId && q.commissionStatus === "credited") return res.json({ success: true, astrologerPaymentId: q.astrologerPaymentId, commissionAmount: amount, already: true });
    const paymentId = await nextPaymentId();
    const astrologerPaymentId = paymentId.replace(/^SMV-PAY-/, "SMV-PAT-");
    await db.collection("smv_payments").doc(astrologerPaymentId).set({ paymentId: astrologerPaymentId, type:"astrologer_earning", customerId:q.customerId||null, astrologerId:q.astrologerId, questionId, bookingId:q.bookingId||null, grossAmount:Number(q.amount||0), commissionPercent:Number(q.commissionPercent||q.commissionRate||0), commissionAmount:amount, earningAmount:amount, status:"credited", paymentStatus:"pending_withdrawal", source:"admin_answer_approval", createdAt:FieldValue.serverTimestamp(), updatedAt:FieldValue.serverTimestamp() });
    await qRef.update({ astrologerPaymentId:astrologerPaymentId, commissionStatus:"credited", commissionCreditedAt:FieldValue.serverTimestamp(), commissionAmount:amount });
    return res.json({ success:true, astrologerPaymentId:astrologerPaymentId, commissionAmount:amount });
  } catch(e) { console.error("Commission credit error:",e); return res.status(500).json({ error:e?.message||"Unable to credit commission." }); }
});


app.post("/admin/reject-answer", express.json({limit:"10kb"}), async (req,res)=>{
  const user=await requireUser(req,res); if(!user)return;
  if(!(await isAdminUser(user))) return res.status(403).json({error:"Admin access denied."});
  try{
    const questionId=String(req.body?.questionId||"").trim();
    const reason=String(req.body?.reason||"").trim();
    if(!questionId||!reason) return res.status(400).json({error:"Question ID and rejection reason are required."});
    const ref=db.collection("smv_questions").doc(questionId);
    const snap=await ref.get(); if(!snap.exists) return res.status(404).json({error:"Question not found."});
    const q=snap.data()||{};
    if(!q.astrologerId) return res.status(409).json({error:"Astrologer is not assigned."});
    if(["answered","question_rejected","admin_rejected"].includes(String(q.status||""))) return res.status(409).json({error:"This question is already closed."});
    if(!String(q.answer||"").trim()) return res.status(400).json({error:"No astrologer answer is available to reject."});
    await ref.update({
      status:"revision_required", allocationStatus:"claimed_by_astrologer",
      astrologerAnswerStatus:"revision_required", astrologerEditMode:true,
      adminRejectionReason:reason, adminRejectedAt:FieldValue.serverTimestamp(), adminRejectedBy:user.uid,
      commissionStatus:"allocated_pending_answer", updatedAt:FieldValue.serverTimestamp()
    });
    await db.collection("smv_notifications").add({userId:q.astrologerId,type:"answer_rejected",title:"Answer revision required",message:`Please revise and resubmit your answer. Reason: ${reason}`,questionId,createdAt:FieldValue.serverTimestamp(),read:false});
    await writeAdminAudit("ANSWER_REJECTED",questionId,user.uid,{reason,astrologerId:q.astrologerId});
    return res.json({success:true,questionId,astrologerId:q.astrologerId,status:"revision_required"});
  }catch(e){console.error("Admin reject answer error:",e);return res.status(500).json({error:e?.message||"Unable to reject answer."});}
});

app.post("/admin/approve-answer", express.json({limit:"20kb"}), async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  if (!(await isAdminUser(user))) return res.status(403).json({ error: "Admin access denied." });
  const questionId = String(req.body?.questionId || "").trim();
  try {
    if (!questionId) return res.status(400).json({ error: "Question ID is required." });
    const qRef = db.collection("smv_questions").doc(questionId);
    const snap = await qRef.get();
    if (!snap.exists) return res.status(404).json({ error: "Question not found." });
    const q = snap.data() || {};
    if (!q.astrologerId) return res.status(400).json({ error: "Astrologer is not assigned." });
    if (["question_rejected","admin_rejected"].includes(String(q.status||""))) return res.status(409).json({ error: "This question was rejected and refunded. Its answer cannot be approved." });
    if (!String(q.answer || "").trim()) return res.status(400).json({ error: "No answer found." });
    const alreadyApproved = String(q.status || "") === "answered" && String(q.astrologerAnswerStatus || "") === "approved";
    // IMPORTANT: An answer may have been approved before email delivery was fixed.
    // Do not return early in that case. Re-run the email notification so Admin can
    // safely approve/retry and the customer still receives the message.
    const amount = Number(q.astrologerCommissionAmount || q.commissionAmount || 0);
    if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: "Invalid astrologer commission amount." });

    let astrologerPaymentId = q.astrologerPaymentId || "";
    if (!alreadyApproved && (!astrologerPaymentId || String(q.commissionStatus || "") !== "credited")) {
      const paymentId = await nextPaymentId();
      astrologerPaymentId = paymentId.replace(/^SMV-PAY-/, "SMV-PAT-");
      await db.collection("smv_payments").doc(astrologerPaymentId).set({
        paymentId: astrologerPaymentId, type:"astrologer_earning", customerId:q.customerId||null,
        astrologerId:q.astrologerId, questionId, bookingId:q.bookingId||null,
        grossAmount:Number(q.amount||0), commissionPercent:Number(q.commissionPercent||q.commissionRate||0),
        commissionAmount:amount, earningAmount:amount, status:"credited", paymentStatus:"pending_withdrawal",
        source:"admin_answer_approval", createdAt:FieldValue.serverTimestamp(), updatedAt:FieldValue.serverTimestamp()
      });
    }

    if (!alreadyApproved) {
      await qRef.update({
        status:"answered",
        astrologerAnswerStatus:"approved",
        commissionStatus:"credited",
        answerApprovedAt:FieldValue.serverTimestamp(),
        adminAnswerApprovedAt:FieldValue.serverTimestamp(),
        answerApprovedBy:user.uid,
        commissionCreditedAt:q.commissionCreditedAt || FieldValue.serverTimestamp(),
        commissionAmount:amount,
        astrologerCommissionAmount:amount,
        astrologerPaymentId,
        updatedAt:FieldValue.serverTimestamp(),
        answerApprovalEmailStatus:{state:"pending",updatedAt:FieldValue.serverTimestamp(),retry:true}
      });

      await db.collection("smv_notifications").add({
        userId:q.astrologerId,type:"answer_approved",title:"Answer Approved",
        message:`Your answer has been approved. Commission credited: ₹${amount.toFixed(2)}`,
        questionId,commissionAmount:amount,createdAt:FieldValue.serverTimestamp(),read:false
      });
      await writeAdminAudit("ANSWER_APPROVED", questionId, user.uid, {
        commissionAmount: amount, astrologerId: q.astrologerId, customerId: q.customerId || null
      });
    } else {
      await qRef.set({
        answerApprovalEmailStatus:{state:"pending",updatedAt:FieldValue.serverTimestamp(),retry:true},
        updatedAt:FieldValue.serverTimestamp()
      }, {merge:true});
    }

    const customerEmail = String(q.customerEmail || await getUserEmail(q.customerId) || "").trim();
    const astrologerEmail = String(await getUserEmail(q.astrologerId) || "").trim();
    const customerName = String(q.customerName || q.birthName || "Customer");
    const astrologerName = String(q.astrologerName || "Astrologer");
    const subject = "SMV ASTRO — Astrology answer approved";
    const results = {};
    const recipients = uniqueRecipients([customerEmail, astrologerEmail, ADMIN_EMAIL]);
    for (const recipient of recipients) {
      const key = recipient.toLowerCase();
      const isCustomer = key === customerEmail.toLowerCase();
      const isAstrologer = key === astrologerEmail.toLowerCase();
      const text = isCustomer
        ? `Dear ${customerName},\n\nYour astrology answer has been approved by SMV ASTRO Admin and is now ready to view.\n\nQuestion: ${q.question || ""}\nQuestion ID: ${questionId}\n\nRegards,\nSMV ASTRO`
        : isAstrologer
          ? `Dear ${astrologerName},\n\nYour submitted astrology answer has been approved by SMV ASTRO Admin.\n\nQuestion ID: ${questionId}\nCommission credited: ₹${amount.toFixed(2)}\n\nRegards,\nSMV ASTRO`
          : `SMV ASTRO answer approval notification.\n\nQuestion ID: ${questionId}\nCustomer Email: ${customerEmail || "N/A"}\nAstrologer Email: ${astrologerEmail || "N/A"}\nCommission: ₹${amount.toFixed(2)}`;
      const result = await sendSystemEmail({to:[recipient],replyTo:ADMIN_EMAIL,subject,text});
      if (result?.failed) {
        results[key] = {status:"failed",error:String(result.error || "Unknown email error")};
        console.error(`Resend delivery failed | Question ID: ${questionId} | Recipient Email: ${recipient} | Reason: ${result.error || "Unknown email error"}`);
      } else {
        results[key] = {status:"sent",messageId:result?.id || null};
        console.log(`Resend notification sent | Question ID: ${questionId} | Recipient Email: ${recipient}`);
      }
    }
    const vals = Object.values(results);
    const emailState = !vals.length ? "failed" : vals.every(x=>x.status==="sent") ? "sent" : vals.every(x=>x.status==="failed") ? "failed" : "partial";
    await qRef.set({answerApprovalEmailStatus:{state:emailState,recipients:results,updatedAt:FieldValue.serverTimestamp()}},{merge:true});
    // Never expose Resend delivery state to the Admin/Customer/Astrologer web UI.
    // The business action is successful once the answer is approved and commission is credited.
    return res.json({success:true,questionId,already:alreadyApproved,commissionAmount:amount});
  } catch (e) {
    console.error(`Admin answer approval failed | Question ID: ${questionId || "N/A"} | Reason:`, e?.message || e);
    return res.status(500).json({error:e?.message || "Unable to approve answer."});
  }
});


app.get("/astrologer/earnings", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  try {
    const uid = String(user.uid);
    const [paymentSnap, questionSnap] = await Promise.all([
      db.collection("smv_payments").where("astrologerId", "==", uid).get(),
      db.collection("smv_questions").where("astrologerId", "==", uid).get()
    ]);
    const toIso = (v) => {
      try {
        if (!v) return null;
        if (typeof v.toDate === "function") return v.toDate().toISOString();
        if (v instanceof Date) return v.toISOString();
        if (typeof v === "string") return v;
        return null;
      } catch (_) { return null; }
    };
    const ledger = [];
    const creditedQuestionIds = new Set();
    paymentSnap.docs.forEach(d => {
      const p = d.data() || {};
      if (String(p.type || "") !== "astrologer_earning") return;
      if (String(p.status || "").toLowerCase() !== "credited") return;
      const amount = Number(p.earningAmount ?? p.commissionAmount ?? 0);
      if (!Number.isFinite(amount) || amount < 0) return;
      const qid = String(p.questionId || "");
      if (qid) creditedQuestionIds.add(qid);
      ledger.push({ id: qid || d.id, paymentId: d.id, question: p.question || "Consultation", commission: amount, date: toIso(p.createdAt) });
    });
    // Backward compatibility for older credited questions that predate the
    // canonical astrologer_earning payment ledger.
    questionSnap.docs.forEach(d => {
      const q = d.data() || {};
      if (String(q.status || "") !== "answered" || String(q.commissionStatus || "") !== "credited") return;
      if (creditedQuestionIds.has(d.id)) return;
      const amount = Number(q.astrologerCommissionAmount ?? q.commissionAmount ?? 0);
      if (!Number.isFinite(amount) || amount < 0) return;
      ledger.push({ id:d.id, paymentId:null, question:q.question || "Consultation", commission:amount, date:toIso(q.commissionCreditedAt || q.answerApprovedAt || q.adminAnswerApprovedAt) });
    });
    ledger.sort((a,b) => String(b.date || "").localeCompare(String(a.date || "")));
    const totalEarnings = Math.round(ledger.reduce((sum,x)=>sum+Number(x.commission||0),0)*100)/100;
    return res.json({success:true,totalEarnings,ledger});
  } catch (e) {
    console.error("Astrologer earnings load failed:", e);
    return res.status(500).json({error:"Unable to load astrologer earnings right now."});
  }
});

app.get("/customer/consultations", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  try {
    // Read through the trusted backend so Customer Dashboard is not blocked by
    // client-side Firestore rules/indexes. Always return the canonical document
    // ID as questionId, even for older questions created before this fix.
    const snap = await db.collection("smv_questions").get();
    const toIso = (v) => {
      try {
        if (!v) return null;
        if (typeof v.toDate === "function") return v.toDate().toISOString();
        if (v instanceof Date) return v.toISOString();
        if (typeof v === "string") return v;
        return null;
      } catch (_) { return null; }
    };
    const questions = snap.docs
      .filter(d => String(d.data()?.customerId || "") === String(user.uid))
      .map(d => {
        const q = d.data() || {};
        return {
          id: d.id,
          ...q,
          questionId: String(q.questionId || d.id),
          createdAt: toIso(q.createdAt),
          updatedAt: toIso(q.updatedAt),
          paidAt: toIso(q.paidAt),
          paymentUpdatedAt: toIso(q.paymentUpdatedAt),
          paymentRecordedAt: q.paymentRecordedAt || null,
          adminQuestionRejectedAt: toIso(q.adminQuestionRejectedAt),
          refundRequestedAt: toIso(q.refundRequestedAt),
          refundCreatedAt: toIso(q.refundCreatedAt),
          refundProcessedAt: toIso(q.refundProcessedAt),
          refundFailedAt: toIso(q.refundFailedAt),
          adminQuestionApprovedAt: toIso(q.adminQuestionApprovedAt),
          answerSubmittedAt: toIso(q.answerSubmittedAt),
          answerApprovedAt: toIso(q.answerApprovedAt),
          adminAnswerApprovedAt: toIso(q.adminAnswerApprovedAt),
          commissionCreditedAt: toIso(q.commissionCreditedAt)
        };
      })
      .sort((a,b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    return res.json({ success: true, questions });
  } catch (e) {
    console.error("Customer consultations load failed:", e);
    return res.status(500).json({ error: "Unable to load your consultations right now." });
  }
});

app.post("/verify-payment", express.json(), async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  try {
    const questionId = String(req.body?.questionId || "").trim();
    const orderId = String(req.body?.razorpay_order_id || "").trim();
    const paymentId = String(req.body?.razorpay_payment_id || "").trim();
    const signature = String(req.body?.razorpay_signature || "").trim();
    if (!questionId || !orderId || !paymentId || !signature) return res.status(400).json({ error: "Payment verification data is incomplete." });
    const qSnap = await db.collection("smv_questions").doc(questionId).get();
    if (!qSnap.exists) return res.status(404).json({ error: "Question not found." });
    const q = qSnap.data();
    if (q.customerId !== user.uid) return res.status(403).json({ error: "You do not own this question." });
    if (q.razorpayOrderId !== orderId) return res.status(409).json({ error: "Payment order mismatch." });
    const expected = crypto.createHmac("sha256", RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex");
    if (!signatureEqual(expected, signature)) {
      const mode = RAZORPAY_KEY_ID.startsWith("rzp_test_") ? "test" : (RAZORPAY_KEY_ID.startsWith("rzp_live_") ? "live" : "unknown");
      console.error("Payment verification signature mismatch", { questionId, orderId, paymentId, mode });
      return res.status(401).json({ error: "Invalid payment signature. Check that Render RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET belong to the same Razorpay mode (both Test or both Live)." });
    }
    let payment = await razorpay.payments.fetch(paymentId);
    if (payment.order_id !== orderId) return res.status(409).json({ error: "Payment order mismatch." });
    const expectedAmount = Math.round(Number(q.amount || 0) * 100);
    if (Number(payment.amount) !== expectedAmount) return res.status(409).json({ error: "Payment amount mismatch." });

    // Razorpay can return an authorised payment before automatic capture.
    // Capture it server-side, then fetch again and continue verification.
    const paymentStatus = String(payment.status || "").toLowerCase();
    if (paymentStatus === "authorized") {
      try {
        await razorpay.payments.capture(paymentId, expectedAmount, String(payment.currency || "INR"));
      } catch (captureError) {
        console.error("Razorpay capture error:", captureError);
        // It may have been captured concurrently; re-fetch before failing.
      }
      payment = await razorpay.payments.fetch(paymentId);
    }
    if (String(payment.status).toLowerCase() !== "captured") {
      return res.status(409).json({
        error: "Payment is authorised but could not be captured yet.",
        paymentStatus: payment.status || null,
        paymentId,
        orderId
      });
    }
    const result = await markQuestionPaid(questionId, orderId, paymentId, signature, "render_checkout_verification");
    await db.collection("razorpay_orders").doc(orderId).set({ razorpayPaymentId: paymentId, status: "verified", questionId, verifiedAt: FieldValue.serverTimestamp() }, { merge: true });
    return res.json({ verified: true, questionId, alreadyProcessed: result.already, customerPaymentId: result.customerPaymentId || null, paymentRecordedAt: result.paymentRecordedAt || new Date().toISOString(), message: "Payment verified and consultation updated successfully." });
  } catch (e) {
    console.error("Payment verification error:", e);
    return res.status(500).json({ error: e?.error?.description || e?.description || e?.message || "Payment verification failed" });
  }
});

// V121 Astrology calculation engine: sidereal/Vedic chart using Astronomy Engine.
// The ephemeris library supplies astronomical positions; Lahiri ayanamsa and
// traditional Vedic mappings are applied here. Birth place coordinates are required
// for the ascendant because a city name alone is not enough for astronomical accuracy.
const VEDIC_RASIS = ["மேஷம்","ரிஷபம்","மிதுனம்","கடகம்","சிம்மம்","கன்னி","துலாம்","விருச்சிகம்","தனுசு","மகரம்","கும்பம்","மீனம்"];
const NAKSHATRAS = ["அஸ்வினி","பரணி","கார்த்திகை","ரோகிணி","மிருகசீரிடம்","திருவாதிரை","புனர்பூசம்","பூசம்","ஆயில்யம்","மகம்","பூரம்","உத்திரம்","ஹஸ்தம்","சித்திரை","சுவாதி","விசாகம்","அனுஷம்","கேட்டை","மூலம்","பூராடம்","உத்திராடம்","திருவோணம்","அவிட்டம்","சதயம்","பூரட்டாதி","உத்திரட்டாதி","ரேவதி"];
const NAK_LORDS = ["கேது","சுக்கிரன்","சூரியன்","சந்திரன்","செவ்வாய்","ராகு","குரு","சனி","புதன்"];
const DASHA_YEARS = {"கேது":7,"சுக்கிரன்":20,"சூரியன்":6,"சந்திரன்":10,"செவ்வாய்":7,"ராகு":18,"குரு":16,"சனி":19,"புதன்":17};
const DASHA_ORDER = ["கேது","சுக்கிரன்","சூரியன்","சந்திரன்","செவ்வாய்","ராகு","குரு","சனி","புதன்"];
const PLANETS = [
  ["சூரியன்", "Sun"], ["சந்திரன்", "Moon"], ["செவ்வாய்", "Mars"], ["புதன்", "Mercury"],
  ["குரு", "Jupiter"], ["சுக்கிரன்", "Venus"], ["சனி", "Saturn"], ["ராகு", "NorthNode"], ["கேது", "SouthNode"]
];
const BODY_MAP = { Sun: "Sun", Moon: "Moon", Mars: "Mars", Mercury: "Mercury", Jupiter: "Jupiter", Venus: "Venus", Saturn: "Saturn" };
function norm360(x){ x%=360; return x<0?x+360:x; }
function clampNum(v,min,max){ const n=Number(v); return Number.isFinite(n)&&n>=min&&n<=max?n:null; }
function parseBirthDateTime(date,time){
  const ds=String(date||"").trim();
  const ts=String(time||"").trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(ds)) return null;
  let hh, mm;
  // Accept the native mobile <input type="time"> value (HH:mm), plus
  // human-entered 12-hour values such as "10:05 PM" / "10.05 PM".
  let m=ts.match(/^(\d{1,2})[:.](\d{2})$/);
  if(m){ hh=Number(m[1]); mm=Number(m[2]); }
  else {
    m=ts.match(/^(\d{1,2})[:.](\d{2})\s*(AM|PM)$/i);
    if(!m) return null;
    hh=Number(m[1]); mm=Number(m[2]);
    const ap=m[3].toUpperCase();
    if(hh<1||hh>12) return null;
    if(ap==='AM') hh=hh===12?0:hh;
    else hh=hh===12?12:hh+12;
  }
  if(!Number.isInteger(hh)||!Number.isInteger(mm)||hh<0||hh>23||mm<0||mm>59) return null;
  const [y,mo,d]=ds.split("-").map(Number);
  const check=new Date(Date.UTC(y,mo-1,d));
  if(check.getUTCFullYear()!==y || check.getUTCMonth()!==mo-1 || check.getUTCDate()!==d) return null;
  // Project currently targets India; the frontend timezone is Asia/Kolkata.
  // Build the UTC instant explicitly. Never rely on parsing a locale/time string.
  const utcMillis = Date.UTC(y, mo - 1, d, hh, mm, 0, 0) - (330 * 60 * 1000);
  const dt = new Date(utcMillis);
  if (!Number.isFinite(dt.getTime())) return null;
  return dt;
}
function lahiriAyanamsa(date){
  const y=date.getUTCFullYear()+((date.getUTCMonth()+0.5)/12);
  const years=y-2000;
  return 23.85675 + years*(50.290966/3600); // Lahiri-style linearized value near modern dates.
}
function siderealLon(tropical,date){ return norm360(tropical-lahiriAyanamsa(date)); }
function zodiac(longitude){ const lon=norm360(longitude), idx=Math.floor(lon/30), deg=lon-idx*30; return {index:idx, sign:VEDIC_RASIS[idx], degree:deg}; }
function degText(d) {
  const x = norm360(Number(d));
  const withinSign = x % 30;

  let deg = Math.floor(withinSign);

  const minuteFloat = (withinSign - deg) * 60;
  let min = Math.floor(minuteFloat);

  let sec = Math.round((minuteFloat - min) * 60);

  // 59'60" வந்தால் அடுத்த minute-க்கு மாற்றவும்
  if (sec >= 60) {
    sec = 0;
    min += 1;
  }

  // 29°60' வந்தால் அடுத்த degree-க்கு மாற்றவும்
  if (min >= 60) {
    min = 0;
    deg += 1;
  }

  return `${String(deg).padStart(2, "0")}°${String(min).padStart(2, "0")}'${String(sec).padStart(2, "0")}"`;
}
function julianDay(date){ return date.getTime()/86400000 + 2440587.5; }
function meanSiderealTime(date,lon){
  // Use Astronomy Engine's sidereal-time implementation (GAST) and add
  // geographic longitude. This avoids mixing a hand-rolled GMST formula
  // with an apparent/sidereal ascendant calculation.
  const gstHours = (typeof Astronomy.SiderealTime === "function")
    ? Astronomy.SiderealTime(date)
    : null;
  if (Number.isFinite(gstHours)) return norm360(gstHours * 15 + lon);
  const jd=julianDay(date), T=(jd-2451545.0)/36525;
  const gmst=280.46061837 + 360.98564736629*(jd-2451545.0) + 0.000387933*T*T - T*T*T/38710000;
  return norm360(gmst+lon);
}
function ascendantLongitude(date,lat,lon){
  // Eastern horizon intersection using the standard atan2 form.
  // Local sidereal time depends on UTC date/time AND geographic longitude;
  // latitude enters the horizon/ecliptic intersection.
  const T=(julianDay(date)-2451545.0)/36525;
  const eps=(23.439291111 - 0.013004167*T - 0.000000164*T*T + 0.000000504*T*T*T);
  const theta=meanSiderealTime(date,lon)*Math.PI/180;
  const phi=lat*Math.PI/180, e=eps*Math.PI/180;
  const tropical=norm360(Math.atan2(Math.cos(theta), -(Math.sin(theta)*Math.cos(e)+Math.tan(phi)*Math.sin(e)))*180/Math.PI);
  return tropical;
}
function navamsaSignIndex(siderealLon){
  const lon=norm360(siderealLon);
  const rasi=Math.floor(lon/30), part=Math.floor((lon%30)/(30/9));
  // Navamsa starts: movable=1st sign, fixed=9th, dual=5th; then proceeds sequentially.
  const mode=rasi%3;
  const start=mode===0 ? rasi : mode===1 ? (rasi+8)%12 : (rasi+4)%12;
  return (start+part)%12;
}
function navamsaData(lon){
  const idx=navamsaSignIndex(lon);
  const part=Math.floor((norm360(lon)%30)/(30/9))+1;
  return {rasi:VEDIC_RASIS[idx],pada:part};
}
function bhavaCuspsEqual(ascLon){
  // Equal-house bhava sphuta: each cusp is exactly 30° from the Ascendant.
  return Array.from({length:12},(_,i)=>norm360(ascLon+i*30));
}
function houseFromCusp(lon,ascLon){
  return Math.floor(norm360(lon-ascLon)/30)+1;
}
function nodeLongitudes(date){
  const T=(julianDay(date)-2451545.0)/36525;
  const omega=125.04452 - 1934.136261*T + 0.0020708*T*T + (T*T*T)/450000 - (T*T*T*T)/56250;
  const rahu=siderealLon(omega,date); return {rahu,ketu:norm360(rahu+180)};
}
function bodyTropicalLongitude(body,date,observer){
  if(body==="Sun") return Astronomy.SunPosition(date).elon;
  if(body==="Moon") return Astronomy.EclipticGeoMoon(date).lon;
  const vec=Astronomy.GeoVector(Astronomy.Body[body],date,true);
  return Astronomy.Ecliptic(vec).elon;
}
function nakshatraInfo(lon){
  const span=360/27, padaSpan=span/4, idx=Math.floor(norm360(lon)/span), within=norm360(lon)-idx*span;
  return {index:idx,name:NAKSHATRAS[idx],pada:Math.floor(within/padaSpan)+1,lord:NAK_LORDS[idx%9]};
}
function addDays(date, days){ return new Date(date.getTime()+days*365.2425*86400000); }
function isoDate(date){ return date.toISOString().slice(0,10); }
function sequenceFromLord(lord){
  const i=DASHA_ORDER.indexOf(lord);
  if(i<0) throw new Error(`Unknown Vimshottari lord: ${lord}`);
  return DASHA_ORDER.slice(i).concat(DASHA_ORDER.slice(0,i));
}
function buildSubPeriods(parentLord, parentStart, parentEnd, level){
  const seq=sequenceFromLord(parentLord), parentDays=(parentEnd.getTime()-parentStart.getTime())/86400000;
  return seq.map(lord=>{
    const years=DASHA_YEARS[lord];
    // Proportional rule: sub-period = full parent duration * lord years / 120.
    const durationDays=parentDays*(years/120);
    return {lord, years:Number((durationDays/365.2425).toFixed(4)), startDate:null, endDate:null, durationDays};
  }).reduce((acc,x)=>{
    const prev=acc.length?acc[acc.length-1].endDate:parentStart;
    const start=prev, end=new Date(start.getTime()+x.durationDays*86400000);
    acc.push({...x,startDate:start,endDate:end}); return acc;
  },[]).map(x=>({...x,start:isoDate(x.startDate),end:isoDate(x.endDate)}));
}
function buildPratyantar(antarLord, startDate, endDate){
  return buildSubPeriods(antarLord,startDate,endDate,3).map(x=>({lord:x.lord,years:x.years,start:x.start,end:x.end}));
}
function buildAntardasha(mdLord, fullStart, fullEnd, birthDate){
  return buildSubPeriods(mdLord,fullStart,fullEnd,2).map(x=>{
    const visibleStart=x.startDate<birthDate?birthDate:x.startDate;
    const visibleEnd=x.endDate;
    return {
      lord:x.lord,
      years:x.years,
      start:isoDate(visibleStart),
      end:isoDate(visibleEnd),
      hiddenBeforeBirth:x.endDate<=birthDate,
      pratyantars: buildPratyantar(x.lord,x.startDate,x.endDate)
        .filter(p=>new Date(p.end+'T23:59:59')>=birthDate)
        .map(p=>({...p,start:p.start<isoDate(birthDate)?isoDate(birthDate):p.start}))
    };
  }).filter(x=>!x.hiddenBeforeBirth);
}
function dashaAtBirth(moonSiderealLon,date){
  const n=nakshatraInfo(moonSiderealLon), span=360/27, progressed=(norm360(moonSiderealLon)%span)/span;
  const lord=n.lord, total=DASHA_YEARS[lord], balance=total*(1-progressed);
  if (!lord || !Number.isFinite(total) || !Number.isFinite(balance)) throw new Error("Unable to calculate Vimshottari Dasha from Moon longitude.");
  const idx=DASHA_ORDER.indexOf(lord), elapsed=total-balance;
  let fullStart=addDays(date,-elapsed), start=fullStart;
  const periods=[];
  for(let i=0;i<9;i++){
    const name=DASHA_ORDER[(idx+i)%9], years=DASHA_YEARS[name];
    const end=addDays(start,years);
    if(end>date){
      const visibleStart=start<date?date:start;
      periods.push({lord:name,years:Number(years.toFixed(2)),start:isoDate(visibleStart),end:isoDate(end),antardashas:buildAntardasha(name,start,end,date)});
    }
    start=end;
  }
  return {
    balanceYears:Number(balance.toFixed(2)),
    order:DASHA_ORDER,
    periods,
    current:{mahadasha:null,antardasha:null,pratyantardasha:null}
  };
}

function circularLonDiff(a,b){ return ((Number(a)-Number(b)+540)%360)-180; }
function localDateFromJd(jdUt, offsetMinutes){
  const ms=(Number(jdUt)-2440587.5)*86400000 + Number(offsetMinutes||330)*60000;
  const d=new Date(ms); return {date:d.toISOString().slice(0,10),time:d.toISOString().slice(11,19).slice(0,5)};
}
function findTajakaAnnualChart(input,targetYear){
  const birthDate=String(input?.date||'');
  const bm=birthDate.match(/^(\d{4})-(\d{2})-(\d{2})$/); if(!bm)return null;
  const y=Number(targetYear); const month=Number(bm[2]), day=Number(bm[3]);
  const natal=SwissVedic.calculateSwiss(input); const natalSun=natal.planets.find(p=>p.name==='சூரியன்')?.longitude; if(!Number.isFinite(natalSun))return null;
  const offset=Number(input?.utcOffsetMinutes??330), base=new Date(Date.UTC(y,month-1,day,12,0,0));
  const sample=[]; for(let h=-120;h<=120;h+=3){const d=new Date(base.getTime()+h*3600000);const local=new Date(d.getTime()+offset*60000);const ds=local.toISOString().slice(0,10),ts=local.toISOString().slice(11,16);try{const c=SwissVedic.calculateSwiss({...input,date:ds,time:ts});const sl=c.planets.find(p=>p.name==='சூரியன்')?.longitude;sample.push({t:d.getTime(),diff:circularLonDiff(sl,natalSun)});}catch{}}
  let lo=null,hi=null; for(let i=1;i<sample.length;i++){if(sample[i-1].diff<=0&&sample[i].diff>=0){lo=sample[i-1].t;hi=sample[i].t;break;} if(sample[i-1].diff>=0&&sample[i].diff<=0){lo=sample[i].t;hi=sample[i-1].t;break;}}
  if(lo==null){sample.sort((a,b)=>Math.abs(a.diff)-Math.abs(b.diff));const best=sample[0];lo=best.t-6*3600000;hi=best.t+6*3600000;}
  for(let i=0;i<42;i++){const mid=(lo+hi)/2;const d=new Date(mid),local=new Date(d.getTime()+offset*60000),ds=local.toISOString().slice(0,10),ts=local.toISOString().slice(11,16);const c=SwissVedic.calculateSwiss({...input,date:ds,time:ts});const sl=c.planets.find(p=>p.name==='சூரியன்')?.longitude;const diff=circularLonDiff(sl,natalSun);const dl=new Date(lo),ll=new Date(dl.getTime()+offset*60000),lds=ll.toISOString().slice(0,10),lts=ll.toISOString().slice(11,16);const cl=SwissVedic.calculateSwiss({...input,date:lds,time:lts});const ld=circularLonDiff(cl.planets.find(p=>p.name==='சூரியன்')?.longitude,natalSun);if((ld<=0&&diff>=0)||(ld>=0&&diff<=0))hi=mid;else lo=mid;}
  const ret=new Date((lo+hi)/2), local=new Date(ret.getTime()+offset*60000), ds=local.toISOString().slice(0,10), ts=local.toISOString().slice(11,16);
  const annual=SwissVedic.calculateSwiss({...input,date:ds,time:ts});
  annual.tajakaReturn={targetYear:y,returnDate:ds,returnTime:ts,natalSunLongitude:natalSun};
  return annual;
}

function calculateVedicChart(input) {
  if (!SwissVedic) {
    throw new Error(
      "Swiss Ephemeris module is unavailable. Run npm install and verify the sweph dependency."
    );
  }

  const chart = SwissVedic.calculateSwiss(input);
  chart.birthName = String(input?.name || '').trim();
  chart.birthDate = String(input?.date || '').trim();
  chart.birthTime = String(input?.time || '').trim();
  chart.birthLat = Number(input?.lat || 0);
  chart.birthLon = Number(input?.lon || 0);

  // ============================================
  // FULL DMS DEGREE FOR PLANETS
  // Example: 09°17'45"
  // ============================================
  if (Array.isArray(chart.planets)) {
    chart.planets = chart.planets.map(p => {
      const copy = { ...p };

      if (Number.isFinite(Number(copy.longitude))) {
        copy.degree = degText(Number(copy.longitude));
      }

      return copy;
    });
  }

  // ============================================
  // FULL DMS DEGREE FOR ASCENDANT
  // Example: 14°12'17"
  // ============================================
  if (
    chart.lagna &&
    Number.isFinite(Number(chart.lagna.longitude))
  ) {
    chart.lagna = {
      ...chart.lagna,
      degree: degText(Number(chart.lagna.longitude))
    };
  }

  // Vimshottari remains driven by Moon longitude
  const moon = chart.planets.find(
    p => p.name === "சந்திரன்"
  );

  chart.dashas = dashaAtBirth(
    moon.longitude,
    new Date(
      chart.birth.utc_jd
        ? (chart.birth.utc_jd - 2440587.5) * 86400000
        : Date.parse(
            chart.birth.date +
            "T" +
            chart.birth.time +
            ":00+05:30"
          )
    )
  );

  return chart;
}

app.post('/api/horoscope/transit', async (req,res)=>{
  try {
    if(!TransitPanchang) throw new Error('Transit/Panchang module is unavailable on the backend.');
    return res.json(TransitPanchang.transit(req.body||{}));
  } catch(e) { console.error('Transit calculation error:', e?.stack||e); return res.status(400).json({error:e?.message||'Transit calculation failed.'}); }
});

app.post('/api/horoscope/panchang', async (req,res)=>{
  try {
    if(!TransitPanchang) throw new Error('Transit/Panchang module is unavailable on the backend.');
    return res.json(TransitPanchang.panchang(req.body||{}));
  } catch(e) { console.error('Panchang calculation error:', e?.stack||e); return res.status(400).json({error:e?.message||'Panchang calculation failed.'}); }
});

app.post('/api/horoscope/dasa', async (req,res)=>{
  try {
    if (typeof phase4Dasa !== 'function') throw new Error('Phase 4 Dasa engine is unavailable on the backend.');
    const chart=req.body?.chart;
    if (!chart || typeof chart !== 'object') throw new Error('Verified horoscope chart data is required.');
    const result=phase4Dasa(chart);
    return res.json({ok:true,phase4:result});
  } catch(e) {
    console.error('[Dasa] calculation error:', e?.stack||e);
    return res.status(400).json({error:e?.message||'Dasa calculation failed.'});
  }
});

app.post('/api/horoscope/full', async (req,res)=>{
  try {
    const body=req.body||{};
    const chart=calculateVedicChart(body);
    chart.nativeName=String(body.name||body.nativeName||'');
    chart.nameInitial=String(body.nameInitial||body.nativeNameInitial||'');
    if(!chart.nameInitial && chart.nativeName){ try { const seg=new Intl.Segmenter(undefined,{granularity:'grapheme'}); chart.nameInitial=seg.segment(chart.nativeName)[Symbol.iterator]().next().value?.segment||Array.from(chart.nativeName)[0]||''; } catch(e) { chart.nameInitial=Array.from(chart.nativeName)[0]||''; } }
    try { const targetYear=Number(body?.tajakaYear)||new Date().getFullYear(); chart.tajakaAnnual=findTajakaAnnualChart(body,targetYear); } catch(e){ chart.tajakaAnnualError=String(e?.message||e); }
    if(typeof advancedAstrology!=='function') throw new Error('Advanced astrology module is unavailable on the backend.');
    if(!TransitPanchang) throw new Error('Transit/Panchang module is unavailable on the backend.');
    const lang=body.language==='en'?'en':'ta';
    const advanced=advancedAstrology(chart,lang);
    const birthPanchang=TransitPanchang.panchang({...body,date:body.date,time:body.time});
    const dailyDate=String(body.dailyDate||body.date||'');
    const dailyTime=String(body.dailyTime||body.time||'');
    const dailyPanchang=TransitPanchang.panchang({...body,date:dailyDate,time:dailyTime});
    const transit=TransitPanchang.transit({...body,date:dailyDate,time:dailyTime});
    let phase4=null;
    if(typeof phase4Dasa==='function') phase4=phase4Dasa(chart);
    return res.json({ok:true,meta:{complete:true,version:'SMV-full-1'},chart,advanced,birthPanchang,dailyPanchang,transit,phase4});
  } catch(e){
    console.error('[Full] horoscope calculation error:',e?.stack||e);
    return res.status(400).json({ok:false,error:e?.message||'Full horoscope calculation failed.'});
  }
});

app.post('/api/horoscope/advanced', async (req,res)=>{
  try {
    const body=req.body||{};
    console.log('[Advanced] request', {date:body.date,time:body.time,lat:body.lat,lon:body.lon,language:body.language});
    const chart=calculateVedicChart(body);
    chart.nativeName=String(body.name||body.nativeName||'');
    chart.nameInitial=String(body.nameInitial||body.nativeNameInitial||'');
    if(!chart.nameInitial && chart.nativeName){ try { const seg=new Intl.Segmenter(undefined,{granularity:'grapheme'}); chart.nameInitial=seg.segment(chart.nativeName)[Symbol.iterator]().next().value?.segment||Array.from(chart.nativeName)[0]||''; } catch(e) { chart.nameInitial=Array.from(chart.nativeName)[0]||''; } }
    try { const targetYear=Number(body?.tajakaYear)||new Date().getFullYear(); chart.tajakaAnnual=findTajakaAnnualChart(body,targetYear); } catch(e){ chart.tajakaAnnualError=String(e?.message||e); }
    if (typeof advancedAstrology !== 'function') throw new Error('Advanced astrology module is unavailable on the backend.');
    const result=advancedAstrology(chart, body.language==='en'?'en':'ta');
    if (!result || typeof result !== 'object') throw new Error('Advanced astrology engine returned an invalid result.');
    if (!result.ashtakavarga || !Array.isArray(result.ashtakavarga.bhinna)) throw new Error('Ashtakavarga engine returned invalid BAV data.');
    console.log('[Advanced] success', {bavRows:result.ashtakavarga.bhinna.length,savTotal:result.ashtakavarga.sarvaTotal});
    return res.json({ok:true,...result});
  } catch(e){
    console.error('[Advanced] calculation error:',e?.stack||e);
    return res.status(400).json({error:e?.message||'Advanced astrology calculation failed.'});
  }
});

// V165 withdrawal request: all protected counter + withdrawal writes happen on Render
// with Firebase Admin SDK. The browser no longer needs permission to write smv_counters.
app.post("/astrologer/withdrawal-request", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  try {
    const amount = Math.round(Number(req.body?.amount || 0) * 100) / 100;
    const minimumWithdrawal = 300;
    if (!Number.isFinite(amount) || amount < minimumWithdrawal) {
      return res.status(400).json({ error: `Minimum withdrawal is ₹${minimumWithdrawal}.` });
    }

    const profileSnap = await db.collection("smv_users").doc(user.uid).get();
    const profile = profileSnap.exists ? (profileSnap.data() || {}) : {};
    const role = String(profile.role || user.role || "").toLowerCase();
    if (role && role !== "astrologer") {
      return res.status(403).json({ error: "Only an astrologer account can request a withdrawal." });
    }

    const questionSnap = await db.collection("smv_questions")
      .where("astrologerId", "==", user.uid).get();
    let totalEarnings = 0;
    questionSnap.docs.forEach(d => {
      const q = d.data() || {};
      if (q.status === "answered" && q.commissionStatus === "credited") {
        totalEarnings += Number(q.astrologerCommissionAmount || q.commissionAmount || 0);
      }
    });

    const withdrawalSnap = await db.collection("smv_withdrawals")
      .where("astrologerId", "==", user.uid).get();
    let reservedWithdrawals = 0;
    withdrawalSnap.docs.forEach(d => {
      const w = d.data() || {};
      if (["pending", "processing", "paid"].includes(String(w.status || "").toLowerCase())) {
        reservedWithdrawals += Number(w.amount || 0);
      }
    });

    const available = Math.max(0, Math.round((totalEarnings - reservedWithdrawals) * 100) / 100);
    if (amount > available + 0.0001) {
      return res.status(400).json({ error: `Withdrawal amount cannot exceed available earnings of ₹${available.toFixed(2)}.` });
    }

    // Withdrawal cooldown: once a non-rejected withdrawal is requested,
    // the next withdrawal is blocked for a full 7 x 24 hours. This is
    // enforced on the server as well as in the dashboard UI.
    const cooldownMs = 7 * 24 * 60 * 60 * 1000;
    let latestWithdrawalMs = 0;
    withdrawalSnap.docs.forEach(d => {
      const w = d.data() || {};
      const st = String(w.status || 'pending').toLowerCase();
      if (!['pending','processing','paid'].includes(st)) return;
      const raw = w.createdAt || w.requestedAt || w.paidAt || null;
      let ms = 0;
      if (raw && typeof raw.toMillis === 'function') ms = raw.toMillis();
      else if (raw instanceof Date) ms = raw.getTime();
      else if (typeof raw === 'number') ms = raw;
      if (ms > latestWithdrawalMs) latestWithdrawalMs = ms;
    });
    if (latestWithdrawalMs && (Date.now() - latestWithdrawalMs < cooldownMs)) {
      const availableAt = new Date(latestWithdrawalMs + cooldownMs);
      return res.status(400).json({
        error: `Withdrawal is blocked for 7 days after the last withdrawal request. Available again on ${availableAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}.`
      });
    }

    const dateKey = indiaDateKey();
    const counterRef = db.collection("smv_counters").doc(`withdrawal_request_${dateKey}`);
    const withdrawalId = await db.runTransaction(async tx => {
      const snap = await tx.get(counterRef);
      const next = (snap.exists ? Number(snap.data()?.lastNumber || 0) : 0) + 1;
      tx.set(counterRef, { lastNumber: next, dateKey, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return `SMV-WDT-${dateKey}-${String(next).padStart(2, "0")}`;
    });

    // The approved payout method is stored in smv_payouts/{astrologerUid}.
    // Read it at withdrawal time so Admin can pay to the exact approved method.
    const payoutSnap = await db.collection("smv_payouts").doc(user.uid).get();
    const payout = payoutSnap.exists ? (payoutSnap.data() || {}) : {};
    const payoutStatus = String(payout.status || "").toLowerCase();
    if (!payoutSnap.exists || !["approved", "pending_admin_review"].includes(payoutStatus)) {
      return res.status(400).json({ error: "Your bank/UPI payment method is not available for withdrawal. Please contact Admin." });
    }
    const requiredPayout = ["bankName", "accountName", "accountNumber", "ifsc"];
    if (requiredPayout.some(k => !String(payout[k] || "").trim())) {
      return res.status(400).json({ error: "Your approved bank payment details are incomplete. Please contact Admin." });
    }

    const withdrawalRef = db.collection("smv_withdrawals").doc();
    await withdrawalRef.set({
      astrologerId: user.uid,
      astrologerName: profile.name || user.name || user.displayName || "Astrologer",
      amount,
      withdrawalId,
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
      requestedAt: FieldValue.serverTimestamp()
    });

    // Private admin-only snapshot. Never place bank details in smv_withdrawals,
    // because the astrologer is allowed to read their own withdrawal document.
    await db.collection("smv_withdrawal_payouts").doc(withdrawalRef.id).set({
      withdrawalDocId: withdrawalRef.id,
      withdrawalId,
      astrologerId: user.uid,
      astrologerName: profile.name || user.name || user.displayName || "Astrologer",
      bankName: String(payout.bankName || "").trim(),
      accountName: String(payout.accountName || "").trim(),
      accountNumber: String(payout.accountNumber || "").trim(),
      ifsc: String(payout.ifsc || "").trim().toUpperCase(),
      upi: String(payout.upi || "").trim(),
      payoutStatus,
      createdAt: FieldValue.serverTimestamp()
    });

    console.log("Withdrawal request created", { astrologerId:user.uid, withdrawalId, amount, payoutStatus });
    return res.json({
      ok: true,
      withdrawalId,
      paymentId: withdrawalId,
      amount,
      availableAfter: Math.max(0, Math.round((available - amount) * 100) / 100)
    });
  } catch (e) {
    console.error("Withdrawal request error:", e?.stack || e);
    return res.status(500).json({ error: e?.message || "Unable to create withdrawal request." });
  }
});

// V169: Admin marks an astrologer withdrawal as paid.
// Idempotent: creates SMV-PMT exactly once, including repairing an older
// paid withdrawal that was saved without an Admin Payment ID.
app.post("/admin/withdrawal-mark-paid", express.json({limit:"5kb"}), async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  if (!(await isAdminUser(user))) return res.status(403).json({error:"Admin access denied."});
  try {
    const withdrawalDocId = String(req.body?.withdrawalDocId || "").trim();
    if (!withdrawalDocId) return res.status(400).json({error:"Withdrawal document ID is required."});
    const withdrawalRef = db.collection("smv_withdrawals").doc(withdrawalDocId);
    const dateKey = indiaDateKey();
    const counterRef = db.collection("smv_counters").doc(`admin_payment_${dateKey}`);

    const result = await db.runTransaction(async tx => {
      const snap = await tx.get(withdrawalRef);
      if (!snap.exists) throw new Error("Withdrawal request not found.");
      const w = snap.data() || {};
      const status = String(w.status || "").toLowerCase();

      // Already paid with a proper PMT: safe retry, return the same ID.
      const existingAdminPaymentId = String(w.adminPaymentId || "").trim();
      if (status === "paid" && /^SMV-PMT-/.test(existingAdminPaymentId)) {
        return {paymentId: existingAdminPaymentId, withdrawalId:String(w.withdrawalId || ""), amount:Number(w.amount || 0), repaired:false};
      }

      // A previous version may have marked the withdrawal paid but failed to
      // attach SMV-PMT. Repair it here without changing the SMV-WDT.
      if (status !== "processing" && status !== "paid") {
        throw new Error("Only a processing withdrawal can be marked as paid.");
      }

      const c = await tx.get(counterRef);
      const next = (c.exists ? Number(c.data()?.lastNumber || 0) : 0) + 1;
      const id = `SMV-PMT-${dateKey}-${String(next).padStart(2,"0")}`;
      tx.set(counterRef, {lastNumber:next, dateKey, updatedAt:FieldValue.serverTimestamp()}, {merge:true});
      tx.update(withdrawalRef, {
        status:"paid",
        adminPaymentId:id,
        paymentId:id,
        paidAt:w.paidAt || FieldValue.serverTimestamp(),
        updatedAt:FieldValue.serverTimestamp(),
        updatedBy:user.uid
      });
      return {paymentId:id, withdrawalId:String(w.withdrawalId || ""), amount:Number(w.amount || 0), repaired:status === "paid"};
    });

    return res.json({ok:true, ...result});
  } catch (e) {
    console.error("Admin withdrawal mark-paid error:", e?.stack || e);
    return res.status(500).json({error:e?.message || "Unable to mark withdrawal as paid."});
  }
});

// V167 admin-only withdrawal payout details.
// Prefer the private withdrawal snapshot; fall back to the astrologer's currently
// approved payout method so older withdrawal requests can still be paid by Admin.
app.get("/admin/withdrawal-payout/:withdrawalDocId", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (!(await isAdminUser(user))) return res.status(403).json({ error: "Admin access denied." });
  try {
    const withdrawalDocId = String(req.params.withdrawalDocId || "").trim();
    if (!withdrawalDocId) return res.status(400).json({ error: "Withdrawal document ID is required." });

    const withdrawalSnap = await db.collection("smv_withdrawals").doc(withdrawalDocId).get();
    if (!withdrawalSnap.exists) return res.status(404).json({ error: "Withdrawal request not found." });
    const withdrawal = withdrawalSnap.data() || {};

    const snapshotRef = db.collection("smv_withdrawal_payouts").doc(withdrawalDocId);
    const snapshot = await snapshotRef.get();
    let payout = snapshot.exists ? (snapshot.data() || {}) : {};
    let source = snapshot.exists ? "withdrawal_snapshot" : "current_payout_method";

    if (!snapshot.exists && withdrawal.astrologerId) {
      const current = await db.collection("smv_payouts").doc(withdrawal.astrologerId).get();
      if (current.exists) payout = current.data() || {};
    }

    return res.json({
      success: true,
      source,
      bankName: String(payout.bankName || "").trim(),
      accountName: String(payout.accountName || "").trim(),
      accountNumber: String(payout.accountNumber || "").trim(),
      ifsc: String(payout.ifsc || "").trim().toUpperCase(),
      upi: String(payout.upi || "").trim(),
      available: !!(payout.bankName || payout.accountName || payout.accountNumber || payout.ifsc || payout.upi)
    });
  } catch (e) {
    console.error("Admin withdrawal payout details error:", e?.stack || e);
    return res.status(500).json({ error: "Unable to load private payment details." });
  }
});

// V142 location autocomplete: server-side geocoding keeps provider details out of the browser.
const geocodeRateBuckets = new Map();
app.get("/api/geocode", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim().replace(/\s+/g, " ");
    if (q.length < 3) return res.json({ ok:true, results:[] });

    const ip = String(
      req.headers["x-forwarded-for"] ||
      req.socket.remoteAddress ||
      "unknown"
    ).split(",")[0].trim();

    const now = Date.now();
    const last = geocodeRateBuckets.get(ip) || 0;

    if (now - last < 1100) {
      return res.status(429).json({
        error:"வேறு இடத்தைத் தேடுவதற்கு முன் சிறிது நேரம் காத்திருக்கவும்."
      });
    }

    geocodeRateBuckets.set(ip, now);

    const u = new URL("https://photon.komoot.io/api/");
    u.searchParams.set("q", q);
    u.searchParams.set("limit", "50");
    u.searchParams.set("lang", "en");

    // India bounding box:
    // west,south,east,north
    u.searchParams.set("bbox", "68,6,98,37");

    const r = await fetch(u, {
      headers: {
        "Accept":"application/json",
        "User-Agent":"SMV-ASTRO/142 birth-place-autocomplete"
      },
      signal:AbortSignal.timeout(10000)
    });

    if (!r.ok) {
      return res.status(502).json({
        error:"இடத் தேடல் சேவை தற்போது தற்காலிகமாக கிடைக்கவில்லை."
      });
    }

    const data=await r.json();
    const features=Array.isArray(data.features) ? data.features : [];
    const seen=new Set();

    const results=features.map(f=>{
      const p=f.properties || {};
      const c=f.geometry?.coordinates || [];
      const lon=Number(c[0]);
      const lat=Number(c[1]);

      const name=p.name || "";
      const city=p.city || p.town || p.village || p.municipality || p.county || "";
      const state=p.state || "";
      const country=p.country || "India";
      const postcode=p.postcode || "";

      const parts=[name,city,state,postcode,country]
        .filter(Boolean)
        .filter((v,i,a)=>a.indexOf(v)===i);

      return {
        place:parts.join(", "),
        latitude:Number(lat.toFixed(6)),
        longitude:Number(lon.toFixed(6)),
        city,
        state,
        country
      };
    }).filter(x=>{
      if(!Number.isFinite(x.latitude)||!Number.isFinite(x.longitude)||!x.place) return false;
      if(x.country && x.country.toLowerCase()!=="india") return false;

      const key=x.latitude.toFixed(6)+","+x.longitude.toFixed(6);
      if(seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0,50);

    return res.json({ok:true,results});

  } catch(e) {
    console.error("Geocode error:",e?.message||e);
    return res.status(502).json({
      error:"இந்த இடத்தை இப்போது தேட முடியவில்லை. மீண்டும் முயற்சிக்கவும்."
    });
  }
});;;;;

app.post("/api/horoscope/calculate", async (req,res)=>{
  try {
    const body=req.body||{};
    console.log("Horoscope request:", {date: body.date, time: body.time, lat: body.lat, lon: body.lon});
    const chart = calculateVedicChart(body);
    // Core horoscope endpoint intentionally returns ONLY the core verified chart.
    // Advanced astrology is loaded separately by the browser so heavy tables and
    // Phase 4 Dasa calculations cannot block the Generate Horoscope UI.
    return res.json(chart);
  } catch(e){
    console.error("Horoscope calculation error:", e?.stack || e);
    return res.status(400).json({
      error: e?.message || "ஜாதக கணக்கீடு தோல்வியடைந்தது.",
      engineAvailable:!!Astronomy,
      received:{date:req.body?.date||null,time:req.body?.time||null,lat:req.body?.lat??null,lon:req.body?.lon??null}
    });
  }
});

// Shared OpenAI Tamil answer translator used by both Astrologer and Admin answer submission.
// The translation is performed server-side so OPENAI_API_KEY never reaches the browser.
async function translateAnswerToTamil(answerText) {
  const source = String(answerText || "").trim();
  if (!source) return "";
  if (!OPENAI_API_KEY) {
    throw new Error("OpenAI தமிழ் மொழிபெயர்ப்பு சேவை அமைக்கப்படவில்லை. Render Environment Variables-ல் OPENAI_API_KEY-ஐ அமைக்கவும்.");
  }

  const prompt = `
Translate the following astrology consultation answer into natural, polished Tamil for the SMV ASTRO Tamil website.
Rules:
- Preserve the exact meaning, advice, cautions, dates, numbers, names, zodiac signs, nakshatras, planet names, and other factual details.
- Translate all human-readable English into clear Tamil.
- If the answer is already Tamil, keep its meaning and wording as intact as possible; only clean obvious mixed-language fragments when appropriate.
- Do not add predictions, advice, explanations, headings, disclaimers, or facts that are not in the source.
- Do not remove any important sentence.
- Use established Tamil astrology terminology such as ஜோதிடம், ஜாதகம், ராசி, நட்சத்திரம், கிரகம், பாவம், தசா, கோச்சாரம், பரிகாரம் where appropriate.
- Return ONLY the translated answer text. Do not return JSON, markdown fences, or commentary.

ANSWER:
${source}
`;

  let lastDetail = "";
  for (const model of OPENAI_TRANSLATION_FALLBACK_MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60000);
      try {
        const response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model,
            instructions: "நீங்கள் SMV ASTRO தமிழ் ஜோதிட ஆலோசனைக்கான தொழில்முறை மொழிபெயர்ப்பாளர். வழங்கப்பட்ட பதிலின் பொருளை மாற்றாமல் இயல்பான, தெளிவான தமிழில் மொழிபெயர்க்கவும். பதில் உரையை மட்டும் திருப்பி அனுப்பவும்.",
            input: prompt,
            max_output_tokens: 6000
          }),
          signal: controller.signal
        });
        const result = await response.json().catch(() => ({}));
        if (response.ok) {
          const translated = String(result?.output_text || result?.output?.flatMap(x => x?.content || []).map(x => x?.text || "").join("\n") || "").trim();
          if (!translated) {
            lastDetail = "OpenAI எந்த தமிழாக்க பதிலும் வழங்கவில்லை.";
          } else {
            const sourceHasTamil = /[\u0B80-\u0BFF]/.test(source);
            const tamilChars = (translated.match(/[\u0B80-\u0BFF]/g) || []).length;
            if (!sourceHasTamil && tamilChars < 3) {
              lastDetail = "OpenAI தமிழாக்கம் சரியாக உருவாகவில்லை.";
            } else {
              return translated.replace(/^```(?:text)?\s*/i, "").replace(/\s*```$/i, "").trim();
            }
          }
        } else {
          lastDetail = result?.error?.message || `OpenAI API HTTP ${response.status}`;
          if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 1) break;
          await new Promise(r => setTimeout(r, 1500 * (2 ** attempt)));
        }
      } catch (err) {
        lastDetail = err?.name === "AbortError" ? "OpenAI கோரிக்கைக்கு நேரம் முடிந்தது." : (err?.message || "OpenAI request failed");
        if (attempt === 1) break;
        await new Promise(r => setTimeout(r, 1500 * (2 ** attempt)));
      } finally {
        clearTimeout(timer);
      }
    }
  }

  throw new Error(`OpenAI தமிழ் மொழிபெயர்ப்பு சேவை தற்காலிகமாக கிடைக்கவில்லை. (${lastDetail})`);
}

// Tamil translation endpoint for the Tamil website/blog manager.
// OpenAI is called ONLY from Render so OPENAI_API_KEY never reaches the browser.
// Gemini remains available for the separate horoscope AI-future endpoint below.
app.post("/api/translate-tamil", express.json({ limit: "250kb" }), async (req, res) => {
  try {
    if (!OPENAI_API_KEY) {
      return res.status(503).json({ ok:false, error:"OpenAI தமிழ் மொழிபெயர்ப்பு சேவை அமைக்கப்படவில்லை. Render Environment Variables-ல் OPENAI_API_KEY-ஐ அமைக்கவும்." });
    }

    const title = String(req.body?.title || "").trim();
    const summary = String(req.body?.summary || "").trim();
    const body = String(req.body?.body || "").trim();
    if (!title && !summary && !body) {
      return res.status(400).json({ ok:false, error:"மொழிபெயர்க்க வேண்டிய வலைப்பதிவு உள்ளடக்கம் இல்லை." });
    }

    const prompt = `
Translate the following SMV ASTRO blog into natural, polished Tamil for a Tamil-only astrology website.
Rules:
- Translate ALL human-readable English text into Tamil.
- Do NOT leave English sentences, headings, bullet text, or explanations.
- Keep proper names, URLs, email addresses, numbers, dates, currency symbols, HTML tags, and technical identifiers unchanged when necessary.
- Do not add information that is not present.
- Preserve paragraph breaks and list structure.
- Do not use transliterated English when a natural Tamil word exists.
- For astrology terminology use established Tamil terms such as ஜோதிடம், ஜாதகம், ராசி, நட்சத்திரம், கிரகம், பாவம், தசா, கோச்சாரம், பரிகாரம்.
- Return ONLY valid JSON with exactly these keys: title, summary, body.

TITLE:
${JSON.stringify(title)}

SUMMARY:
${JSON.stringify(summary)}

BODY:
${JSON.stringify(body)}
`;

    let lastDetail = "";
    let lastStatus = 502;
    let usedModel = OPENAI_TRANSLATION_MODEL;

    for (const model of OPENAI_TRANSLATION_FALLBACK_MODELS) {
      usedModel = model;
      for (let attempt = 0; attempt < 2; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 60000);
        try {
          const response = await fetch("https://api.openai.com/v1/responses", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${OPENAI_API_KEY}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              model,
              instructions: "நீங்கள் SMV ASTRO தமிழ் வலைத்தளத்திற்கான தொழில்முறை மொழிபெயர்ப்பாளர். வழங்கப்பட்ட உள்ளடக்கத்தை மட்டும் இயல்பான, தெளிவான தமிழில் மொழிபெயர்க்கவும். மனிதர் படிக்கும் ஆங்கில வாக்கியங்களை விட வேண்டாம். சரியான JSON மட்டும் திருப்பி அனுப்பவும்.",
              input: prompt,
              max_output_tokens: 6000
            }),
            signal: controller.signal
          });

          const result = await response.json().catch(() => ({}));
          lastStatus = response.status;
          if (response.ok) {
            const raw = String(result?.output_text || result?.output?.flatMap(x => x?.content || []).map(x => x?.text || "").join("\n") || "").trim();
            if (!raw) {
              lastDetail = "OpenAI எந்த மொழிபெயர்ப்பையும் வழங்கவில்லை.";
              break;
            }

            let translated;
            try {
              translated = JSON.parse(raw);
            } catch (_) {
              const cleaned = raw.replace(/^```json\\s*/i, "").replace(/^```\\s*/i, "").replace(/\\s*```$/, "").trim();
              try { translated = JSON.parse(cleaned); }
              catch (parseErr) {
                lastDetail = "OpenAI JSON மொழிபெயர்ப்பு பதில் சரியான வடிவில் இல்லை.";
                break;
              }
            }

            if (!translated || typeof translated !== "object") {
              lastDetail = "OpenAI translation response is invalid.";
              break;
            }

            const outTitle = String(translated.title || "").trim();
            const outSummary = String(translated.summary || "").trim();
            const outBody = String(translated.body || "").trim();
            if (!outTitle || !outBody) {
              lastDetail = "OpenAI தமிழ் மொழிபெயர்ப்பு முழுமையாக கிடைக்கவில்லை.";
              break;
            }

            const tamilChars = (outTitle + " " + outSummary + " " + outBody).match(/[\u0B80-\u0BFF]/g) || [];
            const sourceHasTamil = /[\u0B80-\u0BFF]/.test(title + summary + body);
            if (!sourceHasTamil && tamilChars.length < 3) {
              lastDetail = "OpenAI தமிழாக்கம் சரியாக உருவாகவில்லை. மீண்டும் முயற்சிக்கவும்.";
              break;
            }

            return res.json({
              ok: true,
              provider: "openai",
              model: usedModel,
              title: outTitle,
              summary: outSummary,
              body: outBody
            });
          }

          lastDetail = result?.error?.message || `OpenAI API HTTP ${response.status}`;
          if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 1) break;
          await new Promise(r => setTimeout(r, 1500 * (2 ** attempt)));
        } catch (err) {
          lastDetail = err?.name === "AbortError" ? "OpenAI கோரிக்கைக்கு நேரம் முடிந்தது." : (err?.message || "OpenAI request failed");
          if (attempt === 1) break;
          await new Promise(r => setTimeout(r, 1500));
        } finally {
          clearTimeout(timer);
        }
      }
    }

    return res.status(lastStatus >= 400 ? 502 : 502).json({
      ok:false,
      error:`OpenAI தமிழ் மொழிபெயர்ப்பு சேவை தற்காலிகமாக கிடைக்கவில்லை. (${lastDetail})`
    });
  } catch (e) {
    console.error("Tamil blog translation error:", e?.stack || e);
    return res.status(500).json({
      ok:false,
      error:e?.message || "தமிழ் மொழிபெயர்ப்பு தோல்வியடைந்தது."
    });
  }
});

app.post("/api/horoscope/ai-future", express.json({ limit: "60kb" }), async (req, res) => {
  try {
    if (!GEMINI_API_KEY) {
      return res.status(503).json({ error: "AI future generation is not configured. Add GEMINI_API_KEY in Render Environment Variables." });
    }
    const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
    const now = Date.now();
    const bucket = aiRateBuckets.get(ip) || { start: now, count: 0 };
    if (now - bucket.start >= AI_RATE_LIMIT_WINDOW_MS) { bucket.start = now; bucket.count = 0; }
    bucket.count += 1;
    aiRateBuckets.set(ip, bucket);
    if (bucket.count > AI_RATE_LIMIT_MAX) {
      return res.status(429).json({ error: "AI பலன் உருவாக்கும் வரம்பு தற்காலிகமாக நிறைவடைந்துள்ளது. சில நிமிடங்கள் கழித்து மீண்டும் முயற்சிக்கவும்." });
    }

    const chart = req.body?.chart;
    const language = String(req.body?.language || "en").toLowerCase() === "ta" ? "ta" : "en";
    if (!chart || typeof chart !== "object") return res.status(400).json({ error: "Chart data is required." });

    // IMPORTANT: Gemini is an interpretation layer only. It must not recalculate
    // astronomy or replace Swiss Ephemeris / Bhava Sphuta values.
    const prompt = `
You are the ${language === "ta" ? "Tamil" : "English"}-language interpretation assistant for SMV ASTRO.
Generate a traditional Vedic astrology interpretation using ONLY the verified chart data supplied below.
Do NOT recalculate planetary positions, ascendant, houses, bhava sphuta, or dasha dates. Do not invent missing data.
Clearly distinguish traditional astrological interpretation from factual certainty. Never promise or guarantee future events.
Write in clear, respectful ${language === "ta" ? "Tamil" : "English"} only. Do not mix languages.
Avoid medical, legal, financial or other high-stakes instructions; where such topics arise, advise the user to consult a qualified professional.

Return these sections with concise headings:
${language === "ta" ? `1. பொதுவான வாழ்க்கை நோக்கு
2. தொழில் / கல்வி
3. பணநிலை
4. திருமணம் / உறவுகள்
5. குடும்பம்
6. முக்கிய வாய்ப்புகள்
7. கவனிக்க வேண்டிய காலங்கள்
8. பாரம்பரிய பரிகார வழிகாட்டல் (optional, non-coercive)
9. முக்கிய குறிப்பு — இது பாரம்பரிய ஜோதிட விளக்கம்; உறுதியான எதிர்கால உத்தரவாதம் அல்ல.` : `1. General Life Outlook
2. Career / Education
3. Finance
4. Marriage / Relationships
5. Family
6. Important Opportunities
7. Important Periods
8. Traditional Guidance (optional, non-coercive)
9. Important Note — this is a traditional astrology interpretation and not a guarantee of future events.`}

Verified chart data:
${JSON.stringify(chart, null, 2)}
`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      let body = {}, r = null, lastDetail = "";
      for (let attempt = 0; attempt < 3; attempt++) {
        r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
          method: "POST",
          headers: { "x-goog-api-key": GEMINI_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: `You are a careful ${language === "ta" ? "Tamil" : "English"} Vedic astrology interpretation assistant. Use only supplied verified chart data, respond only in ${language === "ta" ? "Tamil" : "English"}, and never claim certainty.` }] },
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 2800, thinkingConfig: { thinkingLevel: "low" } }
          }),
          signal: controller.signal
        });
        body = await r.json().catch(() => ({}));
        if (r.ok) break;
        lastDetail = body?.error?.message || `Gemini API HTTP ${r.status}`;
        if (![429,500,502,503,504].includes(r.status) || attempt === 2) break;
        await new Promise(resolve => setTimeout(resolve, 1200 * (2 ** attempt)));
      }
      if (!r?.ok) {
        if (r?.status === 503) lastDetail = "Gemini is temporarily busy. The app retried automatically; please try again in a few seconds.";
        return res.status(502).json({ error: `AI service error: ${lastDetail}` });
      }
      const text = body?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("\\n").trim();
      if (!text) return res.status(502).json({ error: "AI service returned an empty interpretation. Please try again." });
      return res.json({ ok: true, model: GEMINI_MODEL, text });
    } finally { clearTimeout(timer); }
  } catch (e) {
    console.error("AI future generation error:", e);
    return res.status(500).json({ error: e?.name === "AbortError" ? "AI service timed out. Please try again." : (e?.message || "AI generation failed.") });
  }
});

app.post("/api/horoscope/calculate-legacy", async (req,res)=>{
  try { return res.json(calculateVedicChart(req.body||{})); }
  catch(e){ return res.status(400).json({error:e?.message||"ஜாதக கணக்கீடு தோல்வியடைந்தது."}); }
});

app.post("/api/horoscope/validate", async (req,res)=>{
  try {
    const chart=calculateVedicChart(req.body||{});
    return res.json({ok:true,chart,validation:{referenceEngine:"Swiss Ephemeris",license:"See Swiss Ephemeris / sweph licensing terms",note:"Validation endpoint uses Swiss Ephemeris sidereal positions and house cusps. Ensure your ephemeris data and licensing are configured for your deployment."}});
  } catch(e){ return res.status(400).json({error:e?.message||"Validation failed.",engineAvailable:!!Astronomy}); }
});

app.post("/razorpay/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    const signature = req.get("X-Razorpay-Signature");
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!signature || !secret) return res.status(400).send("Invalid webhook configuration");
    const expected = crypto.createHmac("sha256", secret).update(req.body).digest("hex");
    if (!signatureEqual(expected, signature)) return res.status(401).send("Invalid signature");
    const event = JSON.parse(req.body.toString("utf8"));
    const eventType = event.event || "unknown";
    const paymentEntity = event?.payload?.payment?.entity || null;
    const orderEntity = event?.payload?.order?.entity || null;
    const paymentId = paymentEntity?.id || null;
    const orderId = orderEntity?.id || paymentEntity?.order_id || null;
    const eventKey = `${eventType}_${paymentId || orderId || crypto.createHash("sha256").update(req.body).digest("hex")}`.replace(/\//g, "_");
    if (!eventKey) return res.status(400).send("Invalid webhook event key");
    const eventRef = db.collection("razorpay_webhook_events").doc(eventKey);
    if ((await eventRef.get()).exists) return res.status(200).send("OK");
    await eventRef.set({ event: eventType, razorpayPaymentId: paymentId, razorpayOrderId: orderId, receivedAt: FieldValue.serverTimestamp(), processed: false });
    if (orderId) {
      const orderRef = db.collection("razorpay_orders").doc(orderId);
      const orderSnap = await orderRef.get();
      const stored = orderSnap.exists ? orderSnap.data() : {};
      const newStatus = ["payment.captured", "order.paid"].includes(eventType) ? "paid" : eventType === "payment.failed" ? "failed" : null;
      if (newStatus) await orderRef.set({ status: newStatus, razorpayPaymentId: paymentId, lastWebhookEvent: eventType, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      if (newStatus === "paid" && stored.questionId && paymentId) {
        try {
          const qSnap = await db.collection("smv_questions").doc(stored.questionId).get();
          if (qSnap.exists && qSnap.data().paymentStatus !== "paid") await markQuestionPaid(stored.questionId, orderId, paymentId, "", "razorpay_webhook");
        } catch (e) { console.error("Webhook question update failed:", e); }
      }
      if (newStatus === "failed" && stored.questionId) {
        await db.collection("smv_questions").doc(stored.questionId).set({ status: "payment_failed", paymentStatus: "failed", paymentUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
        const qSnap = await db.collection("smv_questions").doc(stored.questionId).get();
        const q = qSnap.exists ? (qSnap.data() || {}) : {};
        const customerEmail = String(q.customerEmail || stored.customerEmail || await getUserEmail(q.customerId || stored.firebaseUid) || "").trim();
        const amount = paymentEntity?.amount != null ? Number(paymentEntity.amount) / 100 : Number(q.amount || stored.amount || 0);
        await sendSystemEmail({
          to: [customerEmail, ADMIN_EMAIL],
          subject: "SMV ASTRO — Payment Failed",
          replyTo: ADMIN_EMAIL,
          text: `A SMV ASTRO payment was not completed.\n\nQuestion ID: ${stored.questionId}\nAmount: ₹${Number(amount || 0).toFixed(2)}\nRazorpay Payment ID: ${paymentId || "N/A"}\nRazorpay Order ID: ${orderId || "N/A"}\nStatus: Failed`
        });
        await sendAdminTransactionEmail({ eventType: "PAYMENT FAILED", paymentId, orderId, amount, currency: "INR", questionId: stored.questionId, customerEmail, status: "failed" });
      }
    }
    // Refund and other Razorpay transaction events are always copied to Admin.
    if (eventType.startsWith("refund.")) {
      const refundEntity = event?.payload?.refund?.entity || {};
      const refundPaymentId = String(refundEntity.payment_id || paymentId || "").trim();
      const amount = refundEntity.amount != null ? Number(refundEntity.amount) / 100 : null;

      // Reconcile the real Razorpay refund back to the customer's question.
      // Refund webhooks normally carry payment_id rather than order_id.
      if (refundPaymentId) {
        try {
          const qSnap = await db.collection("smv_questions").get();
          const match = qSnap.docs.find(d => String(d.data()?.razorpayPaymentId || "") === refundPaymentId);
          if (match) {
            const qRef = match.ref;
            const status = String(refundEntity.status || "").toLowerCase();
            const patch = {
              refundId: refundEntity.id || FieldValue.delete(),
              refundPaymentId,
              refundAmount: amount != null ? amount : Number(match.data()?.refundAmount || 0),
              refundRrn: refundEntity?.acquirer_data?.rrn || refundEntity?.acquirer_data?.bank_reference_number || refundEntity?.acquirer_data?.reference_number || match.data()?.refundRrn || FieldValue.delete(),
              refundStatus: status || (eventType === "refund.processed" ? "processed" : eventType.replace("refund.", "")),
              updatedAt: FieldValue.serverTimestamp()
            };
            if (eventType === "refund.processed" || status === "processed") patch.refundProcessedAt = FieldValue.serverTimestamp();
            if (eventType === "refund.failed" || status === "failed") patch.refundFailedAt = FieldValue.serverTimestamp();
            await qRef.set(patch, {merge:true});
          }
        } catch (reconcileError) {
          console.error("Refund-to-question reconciliation failed:", reconcileError);
        }
      }

      await sendAdminTransactionEmail({
        eventType: eventType.toUpperCase(),
        paymentId: refundEntity.payment_id || paymentId,
        orderId,
        amount,
        currency: refundEntity.currency || "INR",
        questionId: stored?.questionId || null,
        customerEmail: stored?.customerEmail || null,
        status: refundEntity.status || eventType
      });
    } else if (!["payment.captured","order.paid","payment.failed"].includes(eventType)) {
      await sendAdminTransactionEmail({
        eventType: eventType.toUpperCase(),
        paymentId,
        orderId,
        amount: paymentEntity?.amount != null ? Number(paymentEntity.amount) / 100 : null,
        currency: paymentEntity?.currency || orderEntity?.currency || "INR",
        questionId: null,
        customerEmail: null,
        status: eventType
      });
    }
    await eventRef.set({ processed: true, processedAt: FieldValue.serverTimestamp() }, { merge: true });
    return res.status(200).send("OK");
  } catch (e) {
    console.error("Webhook processing error:", e);
    return res.status(500).send("Webhook processing failed");
  }
});

app.use((req, res) => {
  console.warn("Unhandled backend route:", req.method, req.originalUrl);
  if (req.path.startsWith("/api/") || req.path.includes("withdrawal")) {
    return res.status(404).json({ error: "Backend endpoint not found.", path: req.originalUrl });
  }
  return res.status(404).send("Not Found");
});

app.listen(PORT, "0.0.0.0", () => console.log(`SMV ASTRO Razorpay backend running on port ${PORT}`));
