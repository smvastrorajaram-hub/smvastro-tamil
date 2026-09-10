
import { renderAdminWorkflows } from "./admin-workflows.mjs?v=20260910b";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, sendEmailVerification, deleteUser, setPersistence, browserSessionPersistence, GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { getFirestore, collection, query, where, getDocs, getDocsFromServer, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, serverTimestamp, writeBatch, runTransaction, onSnapshot } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

window.__SMV_BUILD="V120-UI";
const firebaseConfig={apiKey:"AIzaSyCKXyfZ9sjGmej7ygxHpzHNcNysMXHuvSs",authDomain:"smv-astro.firebaseapp.com",projectId:"smv-astro",storageBucket:"smv-astro.firebasestorage.app",messagingSenderId:"299081899217",appId:"1:299081899217:web:8d558df08e86037ea539f0"};
let app=null, auth=null, db=null, functions=null, httpsCallableFn=null, firebaseInitError=null;
try{
  app=initializeApp(firebaseConfig);
  auth=getAuth(app);
  // IMPORTANT: Never block the entire Firebase module on persistence setup.
  // A top-level await here prevents ALL later header/dashboard event handlers
  // from being registered until Firebase persistence resolves.
  // This made every header button appear dead on slow connections.
  // Persistence is still requested, but it is non-blocking for UI startup.
  setPersistence(auth,browserSessionPersistence).catch(e=>console.warn("Firebase session persistence setup skipped:",e));
  db=getFirestore(app);
}catch(initError){
  firebaseInitError=initError;
  console.error("SMV ASTRO Firebase initialization failed",initError);
}
const RAZORPAY_BACKEND_URL="https://smvastro-tamil.onrender.com";
// Single backend URL used by all protected API calls, including astrologer answer submission.
// Keep this in the main Firebase module so it is available to the answer-submit handler.
const BACKEND=RAZORPAY_BACKEND_URL; window.SMV_BACKEND_URL=RAZORPAY_BACKEND_URL;
let firebaseFunctionsPromise=null;
async function ensureFirebaseFunctions(){
  if(functions && httpsCallableFn) return {functions,httpsCallable:httpsCallableFn};
  if(!firebaseFunctionsPromise){
    firebaseFunctionsPromise=import("https://www.gstatic.com/firebasejs/12.1.0/firebase-functions.js").then(mod=>{
      functions=mod.getFunctions(app,"asia-south1");
      httpsCallableFn=mod.httpsCallable;
      return {functions,httpsCallable:httpsCallableFn};
    });
  }
  return firebaseFunctionsPromise;
}
async function callFunction(name,data={}){
  const api=await ensureFirebaseFunctions();
  return withTimeout(api.httpsCallable(api.functions,name)(data));
}
const smvReadRequests=new Map();
async function renderApi(path, options={}, userOverride=null){
 const user=userOverride||auth?.currentUser;
 if(!user)throw new Error('Login session is missing. Please login again.');
 const method=(options.method||'GET').toUpperCase(),key=user.uid+':'+path;
 if(method==='GET'&&smvReadRequests.has(key))return smvReadRequests.get(key);
 const task=(async()=>{
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),method==='GET'?20000:60000);
  try{
   const token=await user.getIdToken();
   const response=await fetch(RAZORPAY_BACKEND_URL+path,{...options,cache:'no-store',signal:controller.signal,headers:{'Content-Type':'application/json',...(options.headers||{}),Authorization:`Bearer ${token}`}});
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(data.error||`Service error (${response.status})`);
   return data;
  }catch(e){if(e.name==='AbortError')throw new Error('The request timed out. Refresh the status before retrying an action.');throw e;}
  finally{clearTimeout(timer);}
 })();
 if(method==='GET')smvReadRequests.set(key,task);
 try{return await task;}finally{if(smvReadRequests.get(key)===task)smvReadRequests.delete(key);}
}
function smvAssertLiveCheckout(key){
 if(!/^rzp_live_[A-Za-z0-9]+$/.test(String(key||'')))throw new Error('Payment blocked: this backend returned a Test or invalid Razorpay key. Live payment is required. Backend: '+RAZORPAY_BACKEND_URL);
}
async function renderPublicApi(path, options={}){
  const headers={"Content-Type":"application/json",...(options.headers||{})};
  const response=await fetch(RAZORPAY_BACKEND_URL+path,{...options,headers});
  let data=null; try{data=await response.json();}catch(e){data={};}
  if(!response.ok) throw new Error(data?.error||`Render backend error (${response.status})`);
  return data;
}
const ADMIN_UID="TwjeEIFS3Zcf1SxboLZoujm91Ky2";
let currentUser=null, selectedAstro=null, pendingAfterLogin=null, questionServicePrice=5, pendingQuestionId="", pendingQuestionFingerprint="", loginMethod="email";
// ASK NOW is a protected navigation transaction. Firebase auth callbacks must never
// redirect it to Dashboard while the transaction is opening the கேள்வி Form.
let askNowTransitionLock=false;
// HARD ASK NOW INTENT: independent of pendingAfterLogin so legacy/async code cannot clear it.
window.__SMV_ASK_NOW_INTENT = false;
let smvNavigationEpoch=0;
// Dashboard hydration state: once a customer dashboard has rendered successfully,
// returning from ASK NOW must reveal that existing dashboard instead of starting
// another loading cycle. This is UI/navigation state only.
let dashboardReadyUid=null;
let dashboardReadyAt=0;
let dashboardReadyRole=null;
// ASTROLOGER-ONLY bootstrap cache: prevents duplicate profile reads during
// Astrologer logout -> login -> dashboard initialization.
let astroDashboardBootstrap={uid:null,userData:null,astroData:null};
const $=id=>document.getElementById(id);
const show=id=>$(id)?.classList.remove("hidden"); const hide=id=>$(id)?.classList.add("hidden");
const go=id=>$(id)?.scrollIntoView({behavior:"smooth",block:"start"});
/*
 * SMV ASTRO Dashboard UX:
 * Open a stable dashboard shell immediately after authentication.
 * Firestore/profile/question data is hydrated in the background.
 * IMPORTANT: This shell contains no fake user data and is replaced by the
 * real role-specific dashboard when loadDashboard() completes.
 */
function renderDashboardShell(role=null){
  const r=String(role||'').toLowerCase();
  const title=r==='astrologer'?'ஜோதிடர் முகப்புப் பலகை':r==='customer'?'வாடிக்கையாளர் முகப்புப் பலகை':'முகப்புப் பலகை';
  const box=$("dashboardContent");
  if($("dashboardTitle")) $("dashboardTitle").textContent=title;
  if(!box) return;
  box.innerHTML=`
    <div class="grid" style="margin-top:10px">
      <div class="card">
        <h3 style="margin-top:0">SMV ASTRO-க்கு வரவேற்கிறோம்</h3>
        <p class="small" style="margin-bottom:0">உங்கள் முகப்புப் பலகை தயாராக உள்ளது.</p>
      </div>
      <div class="card">
        <h3 style="margin-top:0">முகப்புப் பலகை</h3>
        <p class="small" style="margin-bottom:0">உங்கள் சமீபத்திய கணக்கு தகவல்கள் இங்கே காண்பிக்கப்படும்.</p>
      </div>
      <div class="card">
        <h3 style="margin-top:0">செயல்பாடுகள்</h3>
        <p class="small" style="margin-bottom:0">சமீபத்திய செயல்பாடுகள் மற்றும் கிடைக்கும் சேவைகள் இங்கே காண்பிக்கப்படும்.</p>
      </div>
    </div>`;
}

function hideHomeSurface(){
  // Hide the COMPLETE public Home surface. Internal views such as கேள்வி Form
  // and Dashboard must never show Blogs/Media/Horoscope/Create-Horoscope content
  // underneath or beside them.
  ["home","askNowSection","approved-astrologers","faq",
   "smv-content-hub","horoscope-tools","tamil-horoscope","english-horoscope","smvInstallAppSection"].forEach(id=>hide(id));
  ["tamilHoroscopeResult","englishHoroscopeResult"].forEach(id=>{const el=$(id);if(el){el.classList.add("hidden");el.innerHTML="";}});
  document.querySelectorAll('header a[href="#home"], header a[href="#contact"], header a[href="#services"], #contactNav').forEach(el=>hideElement(el));
}
function showHomeSurface(){
  ["home","askNowSection","approved-astrologers","faq","smvInstallAppSection"].forEach(id=>show(id));
  hide("register-flow");
  document.querySelectorAll('header a[href="#home"], header a[href="#contact"], header a[href="#services"], #contactNav').forEach(el=>showElement(el));
}
function hideElement(el){if(el) el.classList.add("hidden");}

/* Dashboard/Admin must be a clean internal view. */
function hideDashboardPublicSections(){
  ["smv-content-hub","horoscope-tools","tamil-horoscope","english-horoscope"].forEach(id=>hide(id));
}

function smvShowRoleNav(){
  document.querySelectorAll('header a[href="#home"], header a[href="#contact"], header a[href="#services"], #contactNav').forEach(el=>showElement(el));

  // ONE role-aware Dashboard button only.
  const dash=$("dashLink"), admin=$("adminLink");
  if(dash) showElement(dash);
  if(admin){
    hideElement(admin);
    admin.setAttribute('aria-hidden','true');
    admin.setAttribute('tabindex','-1');
  }
}

let smvInternalView="home";
function smvEnterInternalView(view,push=true){
  smvInternalView=view;
  if(push){try{history.pushState({smvView:view},"",`#${view}`);}catch(_e){}}
}
function smvReturnHome(restoreRoleNav=true){
  ++smvNavigationEpoch;
  askNowTransitionLock=false;
  window.__SMV_ASK_NOW_INTENT=false;
  pendingAfterLogin=null;
  smvInternalView="home";

  // Close every internal view.
  ["dashboard","admin","ask-flow","register-flow","astro-register-form",
   "astro-flow","appointment","contact"].forEach(id=>hide(id));

  // Restore the COMPLETE public Home surface.
  ["home","askNowSection","approved-astrologers","faq","smv-content-hub",
   "english-horoscope"].forEach(id=>{const el=$(id);if(el)el.classList.remove("hidden");});
  hide("horoscope-tools");
  hide("tamil-horoscope");
  const tr=$("tamilHoroscopeResult"), er=$("englishHoroscopeResult");
  if(tr){tr.classList.add("hidden");tr.innerHTML="";}
  if(er){er.classList.add("hidden");er.innerHTML="";}

  if(restoreRoleNav) smvShowRoleNav();
  try{history.replaceState({smvView:"home"},"","#home");}catch(_e){}
  requestAnimationFrame(()=>{
    window.scrollTo({top:0,behavior:"auto"});
    const home=$("home");
    if(home) home.scrollIntoView({behavior:"auto",block:"start"});
  });
}
window.addEventListener("popstate",()=>{
  smvReturnHome(true);
});

function showElement(el){if(el) el.classList.remove("hidden");}
function hidePrimarySections(except=""){
  ["register-flow","astro-register-form","astro-flow","ask-flow","appointment","contact","dashboard","admin"].forEach(id=>{if(id!==except) hide(id);});
  hide("dashLink");
  hide("adminLink");
  if(except==="dashboard" || except==="admin"){
    hideHomeSurface();
    hideDashboardPublicSections();
    hide("register-flow");
    hide("astro-register-form");
    hide("astro-flow");
    hide("ask-flow");
    hide("appointment");
    hide("contact");
  }else{
    showHomeSurface();
  }
}
function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]));}
function message(id,html){if($(id)) $(id).innerHTML=html;}
function withTimeout(promise,ms=15000){return Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error("Firebase did not respond within 15 seconds.")),ms))]);}
window.closeModal=()=>{
  const m=$("modal");
  if(m){
    m.classList.add("hidden");
    m.classList.remove("profile-modal-active","auth-modal-active");
  }

  // If Login was opened from ASK NOW and user closes Login
  // without logging in, return completely to the Home page.
  if(!currentUser && pendingAfterLogin==="question"){
    pendingAfterLogin=null;
    askNowTransitionLock=false;

    hide("dashboard");
    hide("dashboardContent");
    hide("admin");
    hide("ask-flow");
    hide("register-flow");
    hide("astro-register-form");
    hide("astro-flow");
    hide("appointment");
    hide("contact");

    showHomeSurface();

    try{
      smvShowRoleNav();
    }catch(_e){}

    try{
      smvEnterInternalView("home",true);
    }catch(_e){}

    window.scrollTo({top:0,behavior:"smooth"});
  }
};
function openModal(html){$("modalContent").innerHTML=html;$("modal").classList.remove("hidden");}
function smvNotice(title,message,icon="✓"){
  const id="smvNoticeDialog"; let el=document.getElementById(id); if(el)el.remove();
  el=document.createElement("div"); el.id=id; el.className="smv-dialog-backdrop";
  el.innerHTML=`<div class="smv-dialog"><div class="smv-dialog-icon">${icon}</div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(message)}</p><div class="smv-dialog-actions single"><button type="button" class="btn">OK</button></div></div>`;
  document.body.appendChild(el); el.querySelector(".btn").onclick=()=>el.remove(); return el;
}
function smvConfirm(title,message,okText="OK",cancelText="CANCEL",danger=false){
  return new Promise(resolve=>{
    const id="smvConfirmDialog"; let el=document.getElementById(id); if(el)el.remove();
    el=document.createElement("div"); el.id=id; el.className="smv-dialog-backdrop";
    el.innerHTML=`<div class="smv-dialog"><div class="smv-dialog-icon">${danger?"!":"?"}</div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(message)}</p><div class="smv-dialog-actions"><button type="button" class="btn gray" data-cancel>${escapeHtml(cancelText)}</button><button type="button" class="btn ${danger?"danger":""}" data-ok>${escapeHtml(okText)}</button></div></div>`;
    document.body.appendChild(el); const finish=value=>{el.remove();resolve(value)};
    el.querySelector("[data-cancel]").onclick=()=>finish(false); el.querySelector("[data-ok]").onclick=()=>finish(true);
  });
}

// ---------- Navigation ----------
function openRegister(){hidePrimarySections("register-flow");show("register-flow");go("register-flow");}
function openAstroRegister(){hidePrimarySections("astro-register-form");show("astro-register-form");go("astro-register-form");}

async function openCustomerRegistration(){
  if(currentUser){
    await logoutToHome();
  }
  openRegister();
}

async function openAstrologerRegistration(){
  if(currentUser){
    await logoutToHome();
  }
  openAstroRegister();
}
function openAstroFlow(){openQuestionService();}
async function openQuestionService(options={}){
  // Every entry through ASK NOW owns this transaction until Home/Back/payment completion.
  window.__SMV_ASK_NOW_INTENT=true;
  const fastAfterLogin=options.fastAfterLogin===true;
  const suppliedProfile=options.profile||null;

  // SINGLE ASK NOW ROUTE:
  // 1) Guest -> Login -> this function again after authentication.
  // 2) Signed-in customer -> கேள்வி Form directly.
  // No Dashboard render is allowed anywhere in this route.
  askNowTransitionLock=true;
  const askEpoch=++smvNavigationEpoch;

  try{
    const signedInUser=auth?.currentUser||currentUser;
    if(!signedInUser){
      pendingAfterLogin="question";
      openAuth("login");
      return;
    }

    currentUser=signedInUser;
    const activeUser=auth?.currentUser||signedInUser;
    if(!activeUser){
      currentUser=null;
      pendingAfterLogin="question";
      openAuth("login");
      return;
    }

    if(!fastAfterLogin){
      try{ await activeUser.reload(); }catch(_e){ console.warn("ASK NOW auth reload skipped",_e); }
    }

    const verifiedUser=auth?.currentUser||activeUser;
    if(!verifiedUser){
      currentUser=null;
      pendingAfterLogin="question";
      openAuth("login");
      return;
    }

    if(verifiedUser.uid!==ADMIN_UID && !verifiedUser.emailVerified){
      await signOut(auth);
      currentUser=null;
      pendingAfterLogin="question";
      openAuth("login");
      return;
    }

    let questionProfile=suppliedProfile;
    if(!questionProfile){
      questionProfile=await getUserProfile(verifiedUser.uid);
    }
    const questionRole=String(questionProfile?.role||"customer").toLowerCase();
    if(questionRole!=="customer"){
      askNowTransitionLock=false;
      smvNotice("Customer Login Required","Please login with a Customer account to ask an astrology question.","!");
      return;
    }

    currentUser=verifiedUser;
    // If another navigation started while Firebase/profile data was loading,
    // this stale ASK NOW operation must not repaint the page.
    if(askEpoch!==smvNavigationEpoch){ return; }
    pendingAfterLogin=null;

    // Atomic visual transition: hide every competing surface BEFORE showing form.
    hideHomeSurface();
    ["dashboard","dashboardContent","admin","register-flow","astro-register-form","astro-flow","appointment","contact"].forEach(hide);
    show("ask-flow");
    show("dashLink");
    hide("adminLink");

    selectedAstro=null;
    if($("askTitle")) $("askTitle").textContent="Ask Your கேள்வி";
    loadQuestionPrice().catch(err=>console.warn("கேள்வி price refresh skipped:",err));
    ["birthName","birthDate","birthTime","birthPlace","birthGender","questionText"].forEach(id=>{if($(id)) $(id).value="";});
    message("askMsg","");
    try{window.__smvTranslateCurrentLanguage?.();}catch(_e){}
    smvShowRoleNav();
    smvEnterInternalView("ask-flow",true);
    requestAnimationFrame(()=>{
      const ask=$("ask-flow");
      if(ask) ask.scrollIntoView({behavior:"smooth",block:"start"});
    });
  }catch(err){
    console.error("ASK NOW -> கேள்வி Form failed",err);
    pendingAfterLogin=auth?.currentUser?null:"question";
    // Never fall through to Dashboard on ASK NOW failure.
    hide("dashboard"); hide("dashboardContent");
    const msg=$("askMsg");
    if(msg) msg.innerHTML='<span class="error"><b>கேள்வி Form could not be opened.</b><br>'+escapeHtml(err?.message||String(err))+'</span>';
    if(!auth?.currentUser) openAuth("login");
  }finally{
    // Keep the lock through the synchronous destination render. Firebase auth
    // callbacks that fire later will see smvInternalView === "ask-flow" too.
    askNowTransitionLock=false;
  }
}
window.__smvOpenQuestionService=openQuestionService;
function smvDateTime(value){ try { if(value==null || value==='') return '—'; let d=null; if(value instanceof Date) d=value; else if(typeof value?.toDate==='function') d=value.toDate(); else if(typeof value==='object' && value){ const sec=value.seconds ?? value._seconds; const ns=value.nanoseconds ?? value._nanoseconds ?? 0; if(sec!=null) d=new Date(Number(sec)*1000+Math.floor(Number(ns)/1e6)); else if(value.timestamp) return smvDateTime(value.timestamp); else if(value.date) return smvDateTime(value.date); else if(value.value) return smvDateTime(value.value); } if(!d) d=new Date(value); if(Number.isNaN(d.getTime())) return '—'; return d.toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'}); } catch(e){ return '—'; } }
function smvSortMillis(value){ try { if(value==null || value==='') return 0; if(typeof value?.toMillis==='function') return Number(value.toMillis())||0; if(typeof value?.toDate==='function'){ const d=value.toDate(); return d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : 0; } if(typeof value==='object'){ const sec=value.seconds ?? value._seconds; const ns=value.nanoseconds ?? value._nanoseconds ?? 0; if(sec!=null) return Number(sec)*1000+Math.floor(Number(ns)/1e6); if(value.timestamp) return smvSortMillis(value.timestamp); if(value.date) return smvSortMillis(value.date); if(value.value) return smvSortMillis(value.value); } if(value instanceof Date) return Number.isNaN(value.getTime())?0:value.getTime(); const n=Number(value); if(Number.isFinite(n) && n!==0) return n < 1e12 ? n*1000 : n; const d=new Date(value); return Number.isNaN(d.getTime())?0:d.getTime(); } catch(e){ return 0; } }
function smvQuestionSortTime(q){ return Math.max(smvSortMillis(q?.updatedAt),smvSortMillis(q?.answerApprovedAt),smvSortMillis(q?.answerSubmittedAt),smvSortMillis(q?.adminQuestionApprovedAt),smvSortMillis(q?.paymentRecordedAt),smvSortMillis(q?.createdAt),smvSortMillis(q?.dateTime)); }
function smvAdminSortTime(x){ const q=typeof x?.data==='function'?x.data():(x||{}); return Math.max(smvSortMillis(q?.refundProcessedAt),smvSortMillis(q?.refundCreatedAt),smvSortMillis(q?.paidAt),smvSortMillis(q?.commissionCreditedAt),smvSortMillis(q?.answerApprovedAt),smvSortMillis(q?.answerSubmittedAt),smvSortMillis(q?.adminQuestionApprovedAt),smvSortMillis(q?.paymentRecordedAt),smvSortMillis(q?.rejectedAt),smvSortMillis(q?.reallocatedAt),smvSortMillis(q?.requestedAt),smvSortMillis(q?.publishedAt),smvSortMillis(q?.updatedAt),smvSortMillis(q?.createdAt),smvSortMillis(q?.dateTime)); }

window.__smvOpenQuestionService=openQuestionService;
  window.__smvOpenRegister=openRegister;

function hidePublicHoroscopeSections(){
  ['horoscope-tools','tamil-horoscope','english-horoscope'].forEach(id=>hide(id));
  ['tamilHoroscopeResult','englishHoroscopeResult'].forEach(id=>{const el=$(id);if(el){el.classList.add('hidden');el.innerHTML='';}});
}
if($("authBtn") && $("authBtn").dataset.smvAuthBound!=="1"){ $("authBtn").dataset.smvAuthBound="1"; $("authBtn").addEventListener("click",async()=>{try{hidePublicHoroscopeSections();if(currentUser){await logoutToHome();}else{openAuth("login");}}catch(e){console.error("SMV login action failed",e);}}); }
$("registerNav")?.addEventListener("click",()=>openCustomerRegistration());
document.querySelectorAll('header a[href="#home"]').forEach(el=>{
  el.addEventListener("click",e=>{e.preventDefault();smvReturnHome(true);});
});

// Keep every header control in the same SMV ASTRO style. Logout alone changes to red.
(function syncHeaderAuthStyle(){
  const b=$("authBtn"); if(!b) return;
  const sync=()=>b.classList.toggle("smv-logout-btn",String(b.textContent||"").trim().toLowerCase()==="logout");
  sync();
  new MutationObserver(sync).observe(b,{childList:true,characterData:true,subtree:true});
})();

// Header role label: logged-in role is shown in green.
function setHeaderRoleLabel(role){
  const dash=$('dashLink'), admin=$('adminLink');
  const r=String(role||'').toLowerCase();

  if(dash){
    dash.classList.remove('smv-role-green');
    dash.textContent='டாஷ்போர்டு';

    if(r==='customer'){
      dash.textContent='வாடிக்கையாளர்';
      dash.classList.add('smv-role-green');
    }else if(r==='astrologer'){
      dash.textContent='ஜோதிடர்';
      dash.classList.add('smv-role-green');
    }else if(r==='admin'){
      dash.textContent='நிர்வாகம்';
      dash.classList.add('smv-role-green');
    }
  }

  // Admin has NO separate header button.
  if(admin){
    admin.classList.add('hidden');
    admin.setAttribute('aria-hidden','true');
    admin.setAttribute('tabindex','-1');
  }
}

// V149: Horoscope navigation must restore both public horoscope sections after Login
// temporarily hides them. It does not change the website-wide language.
$("contentNav")?.addEventListener("click",(e)=>{
  e.preventDefault();e.stopPropagation();
  const hub=$("smv-content-hub");if(!hub)return;
  hub.classList.remove("hidden");window.__smvContentVisible=true;
  requestAnimationFrame(()=>hub.scrollIntoView({behavior:"smooth",block:"start"}));
});

  $("horoscopeNav")?.addEventListener("click",(e)=>{
  e.preventDefault(); e.stopPropagation();
  // Tamil-only website: open the existing Tamil horoscope section directly.
  show("horoscope-tools");
  show("tamil-horoscope");
  hide("english-horoscope");
  window.__smvPublicHoroscopeVisible = true;
  requestAnimationFrame(()=>{
    const target=$("tamil-horoscope");
    if(target) target.scrollIntoView({behavior:"smooth",block:"start"});
  });
});

  document.querySelector('header a[href="#home"]')?.addEventListener("click",e=>{
  e.preventDefault();
  smvReturnHome(true);
});

// FINAL ROLE DASHBOARD ROUTER
(function bindRoleDashboardButton(){
  const dash=$("dashLink");
  if(!dash || dash.dataset.smvDashboardRouterBound==="1") return;
  dash.dataset.smvDashboardRouterBound="1";
  dash.addEventListener("click",async e=>{
    e.preventDefault(); e.stopPropagation();
    const epoch=++smvNavigationEpoch;
    try{
      const user=auth?.currentUser||currentUser;
      if(!user){ pendingAfterLogin="dashboard"; openAuth("login"); return; }
      currentUser=user; window.__SMV_ASK_NOW_INTENT=false; askNowTransitionLock=false;
      // Resolve the role once from the signed-in user's profile.  Do not call
      // isCurrentAdmin() here because it performs another profile read and can
      // race the Firebase auth listener during first dashboard load.
      let roleProfile=null;
      let adminUser=(user.uid===ADMIN_UID);
      if(!adminUser){
        roleProfile=await withTimeout(getUserProfile(user.uid),15000);
        adminUser=String(roleProfile?.role||'').toLowerCase()==='admin';
      }
      if(epoch!==smvNavigationEpoch) return;
      if(adminUser){
        hideHomeSurface();
        ["dashboard","dashboardContent","ask-flow","register-flow","astro-register-form","astro-flow","appointment","contact"].forEach(hide);
        show("admin"); hide("dashLink"); hide("adminLink");
        loadAdminPanel().catch(()=>{});
        if(epoch!==smvNavigationEpoch) return;
        setHeaderRoleLabel("admin"); smvShowRoleNav(); smvEnterInternalView("admin",true); go("admin");
      }else{
        const profile=await getUserProfile(user.uid);
        const role=String(profile?.role||"customer").toLowerCase();
        if(epoch!==smvNavigationEpoch) return;
        if(role!=="customer" && role!=="astrologer"){ smvNotice("Dashboard Access","Your account role could not be verified. Please try again.","!"); return; }
        hideHomeSurface();
        ["admin","ask-flow","register-flow","astro-register-form","astro-flow","appointment","contact"].forEach(hide);
        show("dashboard"); show("dashboardContent"); show("dashLink"); hide("adminLink"); hideDashboardPublicSections();
        setHeaderRoleLabel(role); smvEnterInternalView("dashboard",true); go("dashboard");
        // Explicit Dashboard navigation is a real refresh request. Never reuse
        // a previously rendered dashboard here, otherwise a question created
        // moments ago can remain invisible until a full page reload.
        await loadDashboard(role,true);
      }
    }catch(err){
      console.error("Role dashboard navigation failed:",err);
      // The Firebase auth listener is the canonical first-load router. If it
      // has already opened the dashboard while this click is finishing, do not
      // show a false error over a dashboard that is loading successfully.
      if(smvInternalView!=="dashboard" || !document.getElementById("dashboard") || document.getElementById("dashboard").classList.contains("hidden")){
        smvNotice("Dashboard","Unable to open your dashboard. Please try again.","!");
      }
    }
  },true);
})();
$("customerRegBtn")?.addEventListener("click",async e=>{
  e.preventDefault();
  e.stopPropagation();
  try{
    if(currentUser){ await logoutToHome(); }
    openAuth("register");
  }catch(err){ console.error("Customer registration action failed:",err); }
});
$("astroRegBtn")?.addEventListener("click",()=>openAstrologerRegistration());
$("regBackBtn")?.addEventListener("click",e=>{e.preventDefault();smvReturnHome(true);});
$("astroRegBackBtn")?.addEventListener("click",e=>{e.preventDefault();smvReturnHome(true);});
$("backHomeBtn")?.addEventListener("click",e=>{e.preventDefault();smvReturnHome(true);});
$("askNowBackBtn")?.addEventListener("click",e=>{
  e.preventDefault();
  e.stopPropagation();
  if(!currentUser) return smvReturnHome(true);
  ++smvNavigationEpoch;
  askNowTransitionLock=false;
  window.__SMV_ASK_NOW_INTENT=false;
  pendingAfterLogin=null;
  hide("ask-flow");
  show("dashboard");
  show("dashboardContent");
  show("dashLink");
  hide("admin");
  hide("adminLink");
  hideDashboardPublicSections();
  smvShowRoleNav();
  smvEnterInternalView("dashboard",true);
  go("dashboard");
  // If the Customer Dashboard was already rendered before ASK NOW, simply
  // reveal it. Only the first-ever return needs one hydration call.
  if(dashboardReadyUid!==currentUser.uid){
    loadDashboard('customer').catch(err=>console.warn("Dashboard refresh skipped:",err));
  }
});

// Admin no longer has a separate header button.
$("adminLink")?.addEventListener("click",e=>{e.preventDefault();openAdminEntry();});
$("adminFeatureBtn")?.addEventListener("click",e=>{e.preventDefault();openAdminEntry();});

// ---------- Admin access + Login / customer registration ----------
const smvProfiles=new Map();
async function getUserProfile(uid){
 const cached=smvProfiles.get(uid); if(cached&&Date.now()-cached.at<15000)return cached.data;
  try{const s=await withTimeout(getDoc(doc(db,"smv_users",uid)),10000);const data=s.exists()?s.data():{};smvProfiles.set(uid,{data,at:Date.now()});return data;}
  catch(e){console.warn("Profile lookup failed",e);return {};}
}
let __smvAdminDataPromise=null;
async function __smvGetAdminData(){
  if(__smvAdminDataPromise) return __smvAdminDataPromise;
  __smvAdminDataPromise=withTimeout(renderApi('/admin-data',{method:'GET'}),20000);
  try{return await __smvAdminDataPromise;}finally{
    // Keep the promise only long enough for isCurrentAdmin() -> loadAdminPanel()
    // to share the same request. A later explicit reload gets fresh Admin data.
    const p=__smvAdminDataPromise;
    setTimeout(()=>{if(__smvAdminDataPromise===p)__smvAdminDataPromise=null;},0);
  }
}
async function isCurrentAdmin(){
  if(!currentUser) return false;
  if(currentUser.uid===ADMIN_UID) return true;
  const profile=await getUserProfile(currentUser.uid);
  return String(profile.role||'').toLowerCase()==='admin';
}
let smvAdminWatch=null,smvAdminWatchUid=null,smvBoardRequest=null;
async function smvRefreshWorkflowCards(){
 const uid=currentUser?.uid;if(!uid)return;
 if(smvBoardRequest)return smvBoardRequest;
 smvBoardRequest=(async()=>{
  const data=await renderApi('/admin-data',{method:'GET'});
  if(!data?.success)throw new Error(data?.error||'Admin data unavailable.');
  if(currentUser?.uid!==uid)return;
  renderAdminWorkflows({data,api:renderApi,refresh:smvRefreshWorkflowCards,lang:"ta",escape:escapeHtml,date:smvDateTime});
 })();
 try{return await smvBoardRequest;}finally{smvBoardRequest=null;}
}
function smvWatchAdminQuestions(){
 const uid=currentUser?.uid;if(!uid||smvAdminWatchUid===uid)return;
 smvAdminWatch?.();smvAdminWatchUid=uid;let first=true;
 smvAdminWatch=onSnapshot(collection(db,'smv_questions'),()=>{
  if(first){first=false;return;}
  if(currentUser?.uid!==uid||$('admin')?.classList.contains('hidden'))return;
  const button=$('smvRefreshAdmin');if(button)button.textContent='புதிய தகவல் உள்ளது — புதுப்பி';
  if(!document.querySelector('#admin [data-smv-dirty],#admin input:focus,#admin textarea:focus'))smvRefreshWorkflowCards().catch(e=>console.warn('Admin live refresh unavailable:',e));
 },e=>console.warn('Admin live updates unavailable:',e));
}
window.addEventListener('smv:logged-out',()=>{smvAdminWatch?.();smvAdminWatch=null;smvAdminWatchUid=null;});
window.__smvRefreshAdmin=()=>loadAdminPanel();
async function openAdminEntry(){
  if(!currentUser){pendingAfterLogin="admin";openAuth("login");return;}
  if(await isCurrentAdmin()){
    hidePrimarySections("admin");
    show("admin");show("adminLink");
    loadAdminPanel().catch(()=>{});
    setHeaderRoleLabel('admin');
    smvShowRoleNav();
    smvEnterInternalView("admin",true);
    go("admin");return;
  }
  openModal('<h2>Admin Access</h2><div class="error">This account is not an Admin account.</div><p class="small">Please login with the Admin account, then open Admin Dashboard again.</p><button class="btn gray" id="adminAccessClose">Close</button>');
  $("adminAccessClose").onclick=closeModal;
}


function openAuth(mode="login"){
  if(mode==='login')hidePublicHoroscopeSections?.();
  hide("dashboard"); hide("admin"); hide("dashLink"); hide("adminLink"); hide("appointment"); hide("contact"); hide("ask-flow"); hide("register-flow"); hide("astro-register-form"); hide("astro-flow"); hide("smv-content-hub"); window.__smvContentVisible=false;
  closeModal(); loginMethod="email"; const isLogin=mode==="login";
  openModal(`<div class="auth-shell">
    <div class="auth-hero"><div class="auth-hero-icon">✦</div><h2>${isLogin?"மீண்டும் வரவேற்கிறோம்":"கணக்கை உருவாக்கவும்"}</h2><p>${isLogin?"உங்கள் SMV ASTRO முகப்புப் பலகைக்குத் தொடர உள்நுழையவும்.":"உங்கள் பாதுகாப்பான வாடிக்கையாளர் கணக்கை உருவாக்கவும்."}</p></div>
    <div id="authMsg" class="small"></div>
    ${!isLogin?`<label class="auth-field-label">முழுப் பெயர்</label><input class="auth-field" id="name" placeholder="உங்கள் முழுப் பெயர்" autocomplete="name"><label class="auth-field-label">கைபேசி எண்</label><input class="auth-field" id="phone" placeholder="உங்கள் கைபேசி எண்" autocomplete="tel">`:""}
    ${isLogin?`<div class="auth-tabs"><button type="button" class="btn gray" id="loginEmailMode">மின்னஞ்சல் உள்நுழைவு</button><button type="button" class="btn gray" id="loginCustomerIdMode">வாடிக்கையாளர் அடையாள எண்</button><button type="button" class="btn gray" id="loginAstrologerIdMode">ஜோதிடர் அடையாள எண்</button></div>`:""}
    <label class="auth-field-label">${isLogin?"மின்னஞ்சல் / அடையாள எண்":"மின்னஞ்சல்"}</label><input class="auth-field" id="email" type="email" placeholder="மின்னஞ்சல்" autocomplete="email">
    <label class="auth-field-label">கடவுச்சொல்</label><div class="password-wrap"><input class="auth-field" id="password" type="password" placeholder="குறைந்தது 6 எழுத்துகள்" autocomplete="${isLogin?"current-password":"new-password"}"><button type="button" class="password-toggle" id="passwordToggle" aria-label="கடவுச்சொல்லைக் காண்பிக்கவும்">◉</button></div>
    <button class="btn auth-submit" id="submitAuth">${isLogin?"உள்நுழையவும்":"கணக்கை உருவாக்கவும்"}</button>
    ${isLogin?`<div class="auth-divider" aria-hidden="true"><span>அல்லது</span></div><button type="button" class="btn auth-google" id="googleAuthBtn"><span aria-hidden="true" style="font-weight:800;font-size:18px">G</span><span>Google மூலம் தொடரவும்</span></button>`:""}
    ${isLogin?`<button class="btn gray auth-secondary" id="forgotAuth">கடவுச்சொல்லை மறந்துவிட்டீர்களா?</button>`:""}
    <button class="btn gray auth-secondary" id="switchAuth">${isLogin?(pendingAfterLogin==="question"?"புதிய வாடிக்கையாளரா? கணக்கை உருவாக்கவும்":"புதிய வாடிக்கையாளர் கணக்கை உருவாக்கவும்"):"ஏற்கனவே கணக்கு உள்ளதா? உள்நுழையவும்"}</button>
  </div>`);
  $("modal")?.classList.add("auth-modal-active");
  const passwordToggle=$("passwordToggle");
  passwordToggle.onclick=()=>{const p=$("password");const showing=p.type==="text";p.type=showing?"password":"text";passwordToggle.textContent=showing?"◉":"◌";passwordToggle.setAttribute("aria-label",showing?"Show password":"Hide password")};
  if(isLogin){
    const setMethod=(m)=>{loginMethod=m; const input=$("email"); if(!input)return; const idMode=m!=="email"; input.type=idMode?"text":"email"; input.placeholder=m==="customerId"?"வாடிக்கையாளர் அடையாள எண் (எ.கா. SMV-CUS-20082026-01)":m==="astrologerId"?"ஜோதிடர் அடையாள எண் (எ.கா. SMV-AST-20082026-01)":"மின்னஞ்சல் முகவரி"; input.autocomplete=idMode?"username":"email"; $("loginEmailMode")?.classList.toggle("active",m==="email"); $("loginCustomerIdMode")?.classList.toggle("active",m==="customerId"); $("loginAstrologerIdMode")?.classList.toggle("active",m==="astrologerId");};
    $("loginEmailMode").onclick=()=>setMethod("email"); $("loginCustomerIdMode").onclick=()=>setMethod("customerId"); $("loginAstrologerIdMode").onclick=()=>setMethod("astrologerId"); setMethod("email");
  }
  $("submitAuth").onclick=()=>submitAuth(mode); $("switchAuth").onclick=()=>openAuth(isLogin?"register":"login");
  if(isLogin && $("googleAuthBtn")) $("googleAuthBtn").onclick=()=>signInWithGoogle();
  if($("forgotAuth")) $("forgotAuth").onclick=async()=>{const email=$("email").value.trim(),m=$("authMsg"); if(!email){m.innerHTML='<span class="error">முதலில் உங்கள் பதிவு செய்யப்பட்ட மின்னஞ்சல் முகவரியை உள்ளிடவும்.</span>';return;} try{const {sendPasswordResetEmail}=await import("https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js");await withTimeout(sendPasswordResetEmail(auth,email));m.innerHTML='<span class="success">கடவுச்சொல் மீட்டமைப்பு மின்னஞ்சல் அனுப்பப்பட்டது. Inbox மற்றும் Spam கோப்புறையைச் சரிபார்க்கவும்.</span>';}catch(e){m.innerHTML='<span class="error">'+escapeHtml(e.message||String(e))+'</span>';}};
}
window.__smvOpenAuth = openAuth; window.__smvOpenAstroRegister = openAstroRegister;

// Google Sign-In is a customer login method. Existing Email/Password, Customer ID,
// and Astrologer ID flows remain unchanged.
// IMPORTANT: This production site is hosted on GitHub Pages, not Firebase Hosting.
// We therefore use Firebase signInWithPopup() only here. The redirect flow was
// removed because storage partitioning caused Firebase "missing initial state"
// errors on the production domain.
async function finishGoogleCustomerLogin(googleUser, askNowLogin){
  if(!googleUser) throw new Error("Google Sign-In did not return a Firebase user. Please try again.");
  currentUser=googleUser;
  await googleUser.reload();
  const existing=await getUserProfile(googleUser.uid);
  const existingRole=String(existing?.role||"").toLowerCase();
  if(existingRole==="astrologer" || existingRole==="admin" || googleUser.uid===ADMIN_UID){
    askNowTransitionLock=false; window.__SMV_ASK_NOW_INTENT=false; pendingAfterLogin=null;
    await signOut(auth); currentUser=null;
    throw new Error("Google Sign-In is for Customer accounts only. Please use the appropriate Astrologer/Admin login.");
  }
  if(existingRole && existingRole!=="customer") throw new Error("This account role could not be verified.");
  if(!existing?.publicId){
    const profileResponse=await renderApi("/register-customer-profile",{
      method:"POST",
      body:JSON.stringify({name:googleUser.displayName||googleUser.email?.split("@")[0]||"Google Customer",phone:""})
    },googleUser);
    if(!profileResponse?.ok) throw new Error(profileResponse?.error||"Customer profile setup failed.");
  }
  const profile=await getUserProfile(googleUser.uid);
  setHeaderRoleLabel("customer");
  closeModal();
  if(askNowLogin){
    await openQuestionService({fastAfterLogin:true,profile});
    pendingAfterLogin=null;
    return;
  }
  pendingAfterLogin=null;
  hide("admin"); hide("adminLink"); hide("ask-flow"); hide("register-flow"); hide("astro-register-form"); hide("astro-flow");
  hide("appointment"); hide("contact"); hide("home"); hide("askNowSection"); hide("approved-astrologers"); hide("faq");
  show("dashLink"); show("dashboard"); hidePrimarySections("dashboard");
  smvEnterInternalView("dashboard",true);
  await loadDashboard("customer");
  smvShowRoleNav(); smvEnterInternalView("dashboard",true); go("dashboard");
}

async function signInWithGoogle(){
  const btn=$("googleAuthBtn"), msg=$("authMsg");
  if(!auth || firebaseInitError){
    msg.innerHTML='<span class="error">Google Sign-In is currently unavailable. Please use Email Login.</span>';
    return;
  }
  if(pendingAfterLogin==="admin"){
    msg.innerHTML='<span class="error">Google Sign-In is available for Customer accounts only. Please use your Admin login.</span>';
    return;
  }
  btn.disabled=true; btn.innerHTML='<span aria-hidden="true" style="font-weight:800;font-size:18px">G</span><span>Google மூலம் உள்நுழைகிறது...</span>';
  const askNowLogin=pendingAfterLogin==="question" || window.__SMV_ASK_NOW_INTENT===true;
  if(askNowLogin) askNowTransitionLock=true;
  try{
    const provider=new GoogleAuthProvider();
    provider.setCustomParameters({prompt:"select_account"});
    // Popup-only Google authentication. Do not call signInWithRedirect() here:
    // the GitHub Pages production domain previously returned Firebase
    // "missing initial state" when redirect storage was partitioned.
    const result=await withTimeout(signInWithPopup(auth,provider),30000);
    await finishGoogleCustomerLogin(result?.user,askNowLogin);
  }catch(e){
    console.error("Google Sign-In failed",e);
    askNowTransitionLock=false;
    try{if(auth?.currentUser) await signOut(auth);}catch(_){ }
    currentUser=null;
    const code=String(e?.code||"");
    let text="Google Sign-In failed. Please try again or use Email Login.";
    if(code==="auth/popup-closed-by-user") text="Google Sign-In was cancelled.";
    else if(code==="auth/popup-blocked") text="Google Sign-In popup was blocked by the browser. Please allow popups for this website and try again.";
    else if(code==="auth/unauthorized-domain") text="This website domain is not authorized for Google Sign-In in Firebase.";
    else if(code==="auth/operation-not-allowed") text="Google Sign-In is not enabled in Firebase Authentication. Please enable Google under Sign-in providers.";
    else if(e?.message) text=e.message;
    msg.innerHTML='<span class="error">'+escapeHtml(text)+'</span>';
  }finally{
    btn.disabled=false; btn.innerHTML='<span aria-hidden="true" style="font-weight:800;font-size:18px">G</span><span>Google மூலம் தொடரவும்</span>';
  }
}
window.signInWithGoogle=signInWithGoogle;
async function resendVerificationEmail(){
 const email=$("email").value.trim(),password=$("password").value;
 if(!email||!password){
   message("authMsg",'<span class="error">Please enter your email and password first.</span>');
   return;
 }
 try{
   const cred=await signInWithEmailAndPassword(auth,email,password);
   await sendEmailVerification(cred.user);
   await signOut(auth);
   currentUser=null;
   message("authMsg",'<span class="success"><b>Verification link sent successfully.</b> Please check your email.</span>');
 }catch(e){
   try{await signOut(auth);}catch(_){}
   message("authMsg",'<span class="error">Unable to send verification email. Please check your email and password.</span>');
 }
}
window.resendVerificationEmail=resendVerificationEmail;
document.addEventListener("click",e=>{
 const resendBtn=e.target.closest("[data-resend-verification]");
 if(!resendBtn)return;
 e.preventDefault();
 e.stopPropagation();
 if(resendBtn.dataset.sending==="1")return;
 resendBtn.dataset.sending="1";
 resendVerificationEmail().finally(()=>{resendBtn.dataset.sending="";});
});
async function submitAuth(mode){
 const msg=$("authMsg"),rawLogin=$("email").value.trim(),email=rawLogin,password=$("password").value;
 if(!rawLogin||!password){msg.innerHTML='<span class="error">Please enter your email or Customer ID and password.</span>';return;}
 const btn=$("submitAuth");btn.disabled=true;btn.textContent=mode==="login"?"உள்நுழைகிறது...":"Creating...";
 try{
  if(mode==="login"){
    let email=rawLogin;
    if(loginMethod==="customerId" || loginMethod==="astrologerId"){
      const lookup=await withTimeout(renderPublicApi("/lookup-id-login",{method:"POST",body:JSON.stringify({publicId:rawLogin})}),15000);
      const expectedRole=loginMethod==="astrologerId"?"astrologer":"customer";
      if(String(lookup?.role||"").toLowerCase()!==expectedRole) throw new Error(loginMethod==="astrologerId"?"This is not a valid Astrologer ID.":"This is not a valid Customer ID.");
      email=String(lookup?.email||"").trim();
      if(!email) throw new Error("The ID is not linked to a login email.");
    }
    // ASK NOW owns this authentication transaction. Set the lock BEFORE calling
    // Firebase so an onAuthStateChanged callback can never open Dashboard between
    // sign-in success and கேள்வி Form rendering.
    const askNowLogin= pendingAfterLogin==="question" || window.__SMV_ASK_NOW_INTENT===true;
    if(askNowLogin) askNowTransitionLock=true;
    // Mark a normal login BEFORE Firebase fires onAuthStateChanged so that
    // the auth listener can open the dashboard shell immediately.
    if(!askNowLogin && pendingAfterLogin!=="admin"){
      window.__SMV_DASHBOARD_BOOTSTRAP_UID="__PENDING__";
    }
    // Do not wait for a separate auth-state promise here. Firebase already returns
    // the signed-in user from signInWithEmailAndPassword; use that result directly.
    const loginCred=await withTimeout(signInWithEmailAndPassword(auth,email,password),20000);
    if(!loginCred?.user){throw new Error("Login did not return a Firebase user. Please try again.");}
    currentUser=loginCred.user;
    // Tie the bootstrap marker to the exact Firebase UID as soon as sign-in succeeds.
    if(!askNowLogin && pendingAfterLogin!=="admin"){
      window.__SMV_DASHBOARD_BOOTSTRAP_UID=loginCred.user.uid;
    }
    await loginCred.user.reload();

    /* ================================================================
       FAST LOGIN PATH
       Customer/Astrologer login must NEVER wait for Firestore profile data
       before the Dashboard shell appears. Firebase has already authenticated
       the user. The auth-state listener will resolve the role/profile in the
       background and hydrate the correct dashboard.
       Admin and ASK NOW keep their protected routing path below because those
       destinations require role-aware routing before they can be shown.
       ================================================================ */
    const goToQuestion=pendingAfterLogin==="question" || window.__SMV_ASK_NOW_INTENT===true;
    const goToAdmin=pendingAfterLogin==="admin";
    if(!goToQuestion && !goToAdmin && loginCred.user.uid!==ADMIN_UID){
      if(!loginCred.user.emailVerified){
        await signOut(auth);
        currentUser=null;
        pendingAfterLogin=null;
        msg.innerHTML='<span class="error"><b>Please verify your email first.</b><br>Check your email and click the verification link.<br><button type="button" class="btn" data-resend-verification="1" style="margin-top:10px">Resend Verification Email</button></span>';
        return;
      }
      closeModal();
      // Let onAuthStateChanged perform the role resolution and background
      // hydration. It already renders the dashboard shell immediately.
      return;
    }

    const loginProfile=await getUserProfile(loginCred.user.uid);
    const loginRole=String(loginProfile?.role||"customer").toLowerCase();
    const loginStatus=String(loginProfile?.status||"active").toLowerCase();
    if(loginRole!=="admin" && loginCred.user.uid!==ADMIN_UID){
      if(!loginCred.user.emailVerified){
        await signOut(auth);
        currentUser=null;
        pendingAfterLogin=null;
        msg.innerHTML='<span class="error"><b>Please verify your email first.</b><br>Check your email and click the verification link.<br><button type="button" class="btn" data-resend-verification="1" style="margin-top:10px">Resend Verification Email</button></span>';
        return;
      }
    }
    const profile=loginProfile||{};
    const role=String(profile.role||loginRole||"customer").toLowerCase();
    const adminUser=(loginCred.user.uid===ADMIN_UID || role==="admin");
    try{ sessionStorage.setItem("smv_login_role", JSON.stringify({uid:loginCred.user.uid,role:adminUser?"admin":role})); }catch(_e){}
    if(role==='astrologer'){ astroDashboardBootstrap={uid:loginCred.user.uid,userData:profile,astroData:null}; dashboardReadyUid=null; dashboardReadyRole=null; dashboardShellUid=null; }
    setHeaderRoleLabel(adminUser?'admin':role);

    /* IMPORTANT: Do NOT clear pendingAfterLogin before the Firebase
       onAuthStateChanged callback has seen the protected ASK NOW intent.
       signInWithEmailAndPassword() fires onAuthStateChanged asynchronously.
       Clearing this flag here creates a race: the auth listener thinks this
       is a normal login and opens Customer Dashboard while submitAuth() is
       trying to open the கேள்வி Form. This was the root cause of the
       screenshot: Dashboard title visible, கேள்வி Form missing. */
    closeModal();

    /* ASK NOW routing: Customer -> Customer Dashboard + கேள்வி Form.
       Astrologer -> Astrologer Dashboard. Admin -> Admin Dashboard.
       Staff accounts never enter the customer question flow. */
    if(goToQuestion){
      if(adminUser){
        hide("dashboard"); hide("ask-flow"); hide("dashLink");
        hidePrimarySections("admin"); show("admin"); show("adminLink");
        loadAdminPanel().catch(()=>{});
        smvShowRoleNav();
        smvEnterInternalView("admin",true);
        go("admin");
      }else if(role==="astrologer"){
        // ASK NOW is a customer-only transaction. Never route an Astrologer
        // account into the Astrologer Dashboard from this protected action.
        // This prevents the Ask Now flow from interacting with dashboard
        // initialization or causing a dashboard-loading/routing race.
        askNowTransitionLock=false;
        window.__SMV_ASK_NOW_INTENT=false;
        pendingAfterLogin=null;
        hide("dashboard"); hide("dashboardContent"); hide("admin"); hide("ask-flow");
        hide("adminLink");
        smvShowRoleNav();
        smvNotice("Customer Login Required","Ask Now is available for Customer accounts only. Please use a Customer account to ask an astrology question.","!");
      }else{
        await openQuestionService({fastAfterLogin:true,profile});
      }
      // The protected destination has now been consumed. Only clear it AFTER
      // the destination routing has completed so Firebase auth-state callbacks
      // cannot hijack this navigation.
      pendingAfterLogin=null;
      return;
    }
    pendingAfterLogin=null;
    hide("dashboard"); hide("admin"); hide("dashLink"); hide("adminLink");
    if(goToAdmin || adminUser){
      pendingAfterLogin=null;
      if(adminUser){
        hidePrimarySections("admin");
        show("adminLink");
        loadAdminPanel().catch(()=>{});
        smvShowRoleNav();
        smvEnterInternalView("admin",true);
        go("admin");
      }else{
        openModal('<h2>Admin Access</h2><div class="error">This account is not an Admin account.</div><p class="small">Please use your Admin login.</p>');
      }
    }else{
      show("dashLink");
      hidePrimarySections("dashboard");
      hide("register-flow");
      hide("astro-register-form");
      hide("astro-flow");
      hide("ask-flow");
      hide("appointment");
      hide("contact");
      hide("home");
      hide("askNowSection");
      hide("approved-astrologers");
      hide("faq");
      // Enter Dashboard immediately after successful authentication. Do not
      // block navigation on the full Firestore/dashboard hydration. This fixes
      // the Login -> Dashboard case when dashboard data is slow or temporarily
      // unavailable. The dashboard renderer hydrates the already-visible shell.
      show("dashboard");
      show("dashboardContent");
      renderDashboardShell(role);
      smvShowRoleNav();
      smvEnterInternalView("dashboard",true);
      go("dashboard");
      setTimeout(()=>loadDashboard(role).catch(err=>console.warn("Login dashboard load skipped:",err)),120);
    }
    return;
  }
  const name=$("name").value.trim(),phone=$("phone").value.trim();
  if(!name||password.length<6){msg.innerHTML='<span class="error">Enter name and a password of at least 6 characters.</span>';return;}
  let cred=null;
  let createdNewAuthUser=false;
  let profileResponse=null;
  try{
    try{
      cred=await withTimeout(createUserWithEmailAndPassword(auth,email,password),20000);
      createdNewAuthUser=true;
    }catch(authErr){
      // Never silently sign in or repair an existing account from the
      // registration form.  Firebase Authentication has already confirmed
      // that this email belongs to an existing account, so stop registration
      // and give the user a clear next step.
      if(authErr?.code==="auth/email-already-in-use") {
        const existingMsg = '<span class="error"><b>This email is already registered.</b><br>If you have not verified your email, please use <b>Login</b> and choose <b>Resend Verification Email</b>. If you have already verified it, please use Login normally.</span>';
        msg.innerHTML=existingMsg;
        return;
      }
      throw authErr;
    }

    currentUser=cred.user;
    msg.innerHTML='<span class="small">Account created. Setting up your Customer ID...</span>';
    btn.textContent="CREATING CUSTOMER ID...";

    // Profile/counter writes are intentionally handled by the trusted Render
    // backend. This avoids client-side Firestore Rules mismatches during the
    // first registration and prevents a COUNTER_ERROR from leaving a half
    // created Auth account behind.
    profileResponse=await renderApi("/register-customer-profile",{
      method:"POST",
      body:JSON.stringify({name,phone})
    },cred.user);
    if(!profileResponse?.ok) throw new Error(profileResponse?.error||"Customer profile setup failed.");
    try{await withTimeout(sendEmailVerification(cred.user),15000);}catch(ve){console.warn("Verification email could not be sent immediately",ve);}
  }catch(profileErr){
    console.error("Customer registration/profile save failed",profileErr);
    // Do not leave a half-created Auth account behind when this was a brand-new
    // registration. That was the reason subsequent attempts showed
    // auth/email-already-in-use after a COUNTER_ERROR.
    if(createdNewAuthUser && !profileResponse?.ok && auth?.currentUser?.uid===cred?.user?.uid){
      try{await deleteUser(auth.currentUser);}catch(cleanupErr){console.warn("Auth cleanup failed",cleanupErr);}
      currentUser=null;
    }
    throw profileErr;
  }
  const createdId = profileResponse?.publicId ? `<br><b>Your Customer ID:</b> ${escapeHtml(profileResponse.publicId)}<br><span class="small">Keep this ID safe. It can be used for future Customer ID login.</span>` : '';
  msg.innerHTML='<span class="success"><b>Registration successful ✓</b>'+createdId+'<br>Verification email sent. Please verify your account and login again.</span><button class="btn" id="registrationLoginBtn" style="margin-top:10px">Go to Login</button>';
  $("registrationLoginBtn").onclick=async()=>{await logoutToHome();openAuth("login");};
 }catch(e){
  let t=e?.message||String(e);
  if(e?.code==="auth/wrong-password"||e?.code==="auth/invalid-credential") t="Incorrect email or password.";
  if(e?.code==="auth/invalid-email") t="Please enter a correct email ID.";
  if(e?.code==="auth/email-already-in-use") t="This email is already registered. Please use Login. If you have not verified your email, choose Resend Verification Email.";
  if(e?.code==="auth/network-request-failed") t="Network connection failed. Please try again.";
  if(/profile setup failed|server/i.test(t)) t="Registration could not finish the secure profile setup. Please check that the existing Render backend is online, then try again.";
  msg.innerHTML='<span class="error">'+escapeHtml(t)+'</span>';
 }finally{if($("submitAuth")){btn.disabled=false;btn.textContent=mode==="login"?"Login":"கணக்கை உருவாக்கவும்";}}
}
let authReadyResolve;
const authReady=new Promise(r=>authReadyResolve=r);
function waitForAuthReady(){return authReady;}
// ---------- Astrologer list ----------
async function loadAstrologers(){ return loadAstroCards(); }
let smvAstroCardsLoadPromise=null;
let smvAstroListRequest=null;
function loadAstroCards(){
 if(smvAstroListRequest)return smvAstroListRequest;
 smvAstroListRequest=smvLoadAstroCards().finally(()=>smvAstroListRequest=null);return smvAstroListRequest;
}
async function smvLoadAstroCards(){
 const box=$("astroCards");if(!box)return;
 if(smvAstroCardsLoadPromise)return smvAstroCardsLoadPromise;

 smvAstroCardsLoadPromise=(async()=>{
   box.innerHTML='<div class="empty">ஜோதிடர்கள் ஏற்றப்படுகின்றனர்...</div>';
   try{
     /*
      * PUBLIC HOME OPTIMIZATION:
      * Backend and Firestore are checked in parallel instead of waiting
      * 12s for Render and then another 12s for Firebase.
      * The first successful non-empty source wins.
      */
     const backendPromise=(async()=>{
       try{
         const r=await withTimeout(
           fetch(RAZORPAY_BACKEND_URL+"/public/astrologers",{cache:"no-store"}),
           8000
         );
         const d=await r.json().catch(()=>({}));
         if(!r.ok)throw new Error(d.error||`Astrologer service returned HTTP ${r.status}.`);
         return Array.isArray(d.astrologers)?d.astrologers:[];
       }catch(e){
         console.warn("Public astrologer backend unavailable:",e);
         return [];
       }
     })();

     const firestorePromise=(async()=>{
       try{
         if(!db)throw new Error("Firestore is not initialized.");
         const snap=await withTimeout(
           getDocs(query(collection(db,"smv_astrologers"),where("status","==","approved"))),
           8000
         );
         return snap.docs.map(d=>({id:d.id,...(d.data()||{})}));
       }catch(e){
         console.warn("Public astrologer Firestore fallback unavailable:",e);
         return [];
       }
     })();

     let items=[];
     const results=await Promise.allSettled([backendPromise,firestorePromise]);
     for(const result of results){
       if(result.status==="fulfilled" && Array.isArray(result.value) && result.value.length){
         items=result.value;
         break;
       }
     }

     if(!items.length){
       box.innerHTML='<div class="empty">Approved astrologers are temporarily unavailable. Please try again.</div>';
       return;
     }

     box.innerHTML="";
     items.forEach(a=>{
       const card=document.createElement("div");
       card.className="card astro-public-card";
       card.style.marginTop="12px";
       card.innerHTML=`${a.photoData?`<img src="${escapeHtml(a.photoData)}" alt="Astrologer photo" style="width:72px;height:72px;border-radius:50%;object-fit:cover">`:''}<h3><span translate="no">${escapeHtml(a.name||"Astrologer")}</span></h3><p><b>${escapeHtml(a.expertise||a.specialization||"Astrology")}</b></p><p>⭐ ${escapeHtml(a.experience||"Experienced")} years experience</p><div class="action-row"><button class="btn gray" data-profile>சுயவிவரம் மற்றும் மதிப்புரைகள்</button></div>`;
       card.querySelector("[data-profile]").onclick=async()=>{
         const btn=card.querySelector("[data-profile]");
         if(btn){btn.disabled=true;btn.textContent='சுயவிவரம் ஏற்றப்படுகிறது...';}
         try{
           let fn=window.__smvOpenPublicAstrologerProfile;
           for(let i=0;!fn&&i<25;i++){await new Promise(r=>setTimeout(r,120));fn=window.__smvOpenPublicAstrologerProfile;}
           if(typeof fn!=="function")throw new Error("Profile service failed to initialize.");
           await fn(a);
         }catch(err){
           console.error("Public astrologer profile open failed:",err);
           const m=document.getElementById("modal"),c=document.getElementById("modalContent");
           if(m&&c){
             c.innerHTML='<h2>SMV ASTRO</h2><p class="error">Unable to load this astrologer profile. Please try again.</p><button class="btn gray" id="profileRetryBtn">TRY AGAIN</button><button class="btn gray" id="profileCloseBtn">CLOSE</button>';
             m.classList.remove("hidden");
             document.getElementById("profileRetryBtn")?.addEventListener("click",()=>{
               m.classList.add("hidden");card.querySelector("[data-profile]")?.click();
             },{once:true});
             document.getElementById("profileCloseBtn")?.addEventListener("click",()=>m.classList.add("hidden"),{once:true});
           }
         }finally{
           if(btn){btn.disabled=false;btn.textContent="சுயவிவரம் மற்றும் மதிப்புரைகள்";}
         }
       };
       box.appendChild(card);
     });
   }catch(e){
     console.error("Approved astrologers load failed:",e);
     box.innerHTML='<div class="empty error">Approved astrologers are temporarily unavailable.</div>';
   }finally{
     smvAstroCardsLoadPromise=null;
   }
 })();

 return smvAstroCardsLoadPromise;
}
window.__smvReloadAstrologers=loadAstroCards;
window.dispatchEvent(new Event('smv:app-ready'));
let questionPriceUnsubscribe=null;
async function loadQuestionPrice(){
  const rateBox=$("askRate");
  if(rateBox) rateBox.innerHTML='<b>Loading current question price...</b>';
  try{
    const snap=await withTimeout(getDoc(doc(db,"smv_settings","question")),10000);
    if(!snap.exists()) throw new Error("கேள்வி price document is missing: smv_settings/question");
    const v=Number(snap.data()?.price);
    if(!Number.isFinite(v)||v<1) throw new Error("கேள்வி price is invalid in smv_settings/question");
    questionServicePrice=v;
    if(rateBox) rateBox.innerHTML=`<b>₹${questionServicePrice.toFixed(2)} per கேள்வி</b>`;
    if($("publicQuestionPrice")) $("publicQuestionPrice").textContent=`₹${questionServicePrice.toFixed(2)}`;
  }catch(e){
    console.error("QUESTION PRICE LOAD ERROR:",e);
    const adminValue=Number($("questionPrice")?.value);
    if(Number.isFinite(adminValue)&&adminValue>=1){
      questionServicePrice=adminValue;
      if(rateBox) rateBox.innerHTML=`<b>₹${questionServicePrice.toFixed(2)} per கேள்வி</b><br><span class="error small">Firebase public price read failed; payment will be rechecked by the server.</span>`;
    }else{
      questionServicePrice=0;
      if(rateBox) rateBox.innerHTML='<b class="error">கேள்வி price unavailable. Firebase could not read smv_settings/question.</b>';
    }
  }
  if(!questionPriceUnsubscribe){
    questionPriceUnsubscribe=onSnapshot(doc(db,"smv_settings","question"),snap=>{
      const v=Number(snap.data()?.price);
      if(Number.isFinite(v)&&v>=1){
        questionServicePrice=v;
        if($("askRate")) $("askRate").innerHTML=`<b>₹${questionServicePrice.toFixed(2)} per கேள்வி</b>`;
        if($("publicQuestionPrice")) $("publicQuestionPrice").textContent=`₹${questionServicePrice.toFixed(2)}`;
      }
    },err=>console.warn("QUESTION PRICE LISTENER ERROR:",err));
  }
}
function showAskFlow(a){openQuestionService();}

// Customer dashboard retry for questions whose payment was not completed.
// Reuses the existing server-side /create-order endpoint with the SAME questionId,
// so retry never creates a duplicate question.
async function retryCustomerPayment(questionId, triggerButton){
  if(!currentUser) return;
  const id=String(questionId||'').trim();
  if(!id) return;
  const btn=triggerButton;
  if(btn){btn.disabled=true;btn.textContent='CREATING PAYMENT...';}
  try{
    const orderRes=await withTimeout(renderApi("/create-order",{method:"POST",body:JSON.stringify({questionId:id,serviceName:"Public Astrology கேள்வி"})}),30000);
    const {orderId,keyId,amount:paise,currency}=orderRes||{};
    if(!orderId||!keyId) throw new Error(orderRes?.error||"Payment order could not be created. Please try again.");
    const options={
      key:keyId, amount:paise, currency:currency||"INR", name:"SMV ASTRO SERVICES",
      description:"Public astrology question", order_id:orderId,
      prefill:{email:currentUser.email||""}, notes:{questionId:id}, theme:{color:"#6b21a8"},
      handler:async function(response){
        if(btn){btn.disabled=true;btn.textContent='CONFIRMING PAYMENT...';}
        try{
          const vr=await withTimeout(renderApi("/verify-payment",{method:"POST",body:JSON.stringify({
            questionId:id, razorpay_order_id:response.razorpay_order_id,
            razorpay_payment_id:response.razorpay_payment_id, razorpay_signature:response.razorpay_signature
          })}),30000);
          if(!vr?.verified) throw new Error(vr?.error||"Payment verification failed. Please retry.");
          try{sessionStorage.setItem("smv_last_payment_success",JSON.stringify({
            customerUid:currentUser.uid,questionId:id,paymentId:vr.customerPaymentId||"",
            paymentDate:smvDateTime(vr.paymentRecordedAt||new Date())
          }));}catch(_e){}
          await loadDashboard('customer',true);
          await showDashboardPaymentSuccess();
          window.scrollTo({top:0,behavior:'smooth'});
        }catch(e){
          console.error('Retry payment verification failed:',e);
          alert(e?.message||String(e)||'Payment verification failed. Please retry.');
          if(btn){btn.disabled=false;btn.textContent='கட்டணத்தை மீண்டும் முயற்சிக்கவும்';}
        }
      },
      modal:{ondismiss:function(){if(btn){btn.disabled=false;btn.textContent='கட்டணத்தை மீண்டும் முயற்சிக்கவும்';}}}
    };
    smvAssertLiveCheckout(options.key);
  const rzp=new Razorpay(options);
    rzp.on('payment.failed',function(resp){
      console.warn('Retry payment failed:',resp);
      alert('Payment failed: '+(resp?.error?.description||'Please try again.'));
      if(btn){btn.disabled=false;btn.textContent='கட்டணத்தை மீண்டும் முயற்சிக்கவும்';}
    });
    rzp.open();
  }catch(e){
    console.error('Retry payment start failed:',e);
    alert(e?.message||String(e)||'Payment could not be started.');
    if(btn){btn.disabled=false;btn.textContent='கட்டணத்தை மீண்டும் முயற்சிக்கவும்';}
  }
}
window.__smvRetryCustomerPayment=retryCustomerPayment;
$("submitQuestionBtn")?.addEventListener("click",async()=>{
 const name=$("birthName").value.trim();
 const text=$("questionText").value.trim();
 if(!currentUser){message("askMsg",'<span class="error">Please login before asking.</span>');return;}
 if(!name){message("askMsg",'<span class="error">Please enter the person\'s name.</span>');$("birthName").focus();return;}
 if(!$("birthDate").value||!$("birthTime").value||!$("birthPlace").value.trim()){message("askMsg",'<span class="error">Please complete all birth details.</span>');return;}
 if(!text){message("askMsg",'<span class="error">Please enter your question.</span>');return;}
 const amount=Number(questionServicePrice||0);
 if(!Number.isFinite(amount)||amount<1){message("askMsg",'<span class="error">Invalid question price.</span>');return;}
 const btn=$("submitQuestionBtn");btn.disabled=true;btn.textContent="CREATING PAYMENT...";
 // A new payment attempt must never inherit a previous successful-payment banner.
 // The banner is only recreated after the current Razorpay payment is server-verified.
 try{ sessionStorage.removeItem("smv_last_payment_success"); }catch(_e){}
 try{
  // PAYMENT COMPATIBILITY FIX:
  // Create a non-empty Firestore document ID in the browser before calling Render.
  // This keeps the flow compatible with both the new Render backend and any
  // currently-running older backend that still requires questionId.
  // IMPORTANT: birth date/time are stored as the user's entered wall-clock values
  // and explicitly tagged as Asia/Kolkata; they are NOT converted through UTC.
   const makeQuestionId=()=>{try{return crypto.randomUUID().replace(/-/g,"").slice(0,20);}catch(e){return "q_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,12);}};
   const birthDate=$("birthDate").value;
   const birthTime=$("birthTime").value;
   const birthPlace=$("birthPlace").value.trim();
   const birthGender=$("birthGender").value;
   const payload={customerName:name,question:text,amount,birthDetails:{name,birthDate,birthTime,birthPlace,birthGender,timezone:"Asia/Kolkata",utcOffsetMinutes:330},serviceName:"Public Astrology கேள்வி",customerEmail:currentUser.email||""};
  const orderRes=await withTimeout(renderApi("/create-order",{method:"POST",body:JSON.stringify(payload)}),30000);
  if(orderRes?.questionId) pendingQuestionId=String(orderRes.questionId).trim();
  const {orderId,keyId,amount:paise,currency}=orderRes||{};
  if(!pendingQuestionId||!orderId||!keyId){throw new Error("Payment order was not created correctly. Please retry.");}
  // Keep the red payment button in its normal state while Razorpay is opening.
  // Only after Razorpay closes and returns a payment response do we show
  // CONFIRMING PAYMENT... in this same red button while server verification runs.
  const options={
   key:keyId,amount:paise,currency:currency||"INR",name:"SMV ASTRO SERVICES",
   description:"Public astrology question",order_id:orderId,
   prefill:{email:currentUser.email||""},
   notes:{questionId:pendingQuestionId},
   theme:{color:"#6b21a8"},
   handler:async function(response){
    // Razorpay has returned. The same red button now becomes the only status area.
    btn.disabled=true; btn.textContent="CONFIRMING PAYMENT...";
    try{
     message("askMsg","");
     const vr=await withTimeout(renderApi("/verify-payment",{method:"POST",body:JSON.stringify({
      questionId:pendingQuestionId,razorpay_order_id:response.razorpay_order_id,
      razorpay_payment_id:response.razorpay_payment_id,razorpay_signature:response.razorpay_signature
     })}),30000);
     if(vr?.verified){
      const customerPay=vr.customerPaymentId||'நிலுவையில் உள்ளது';
      const astroPay=null;
      message("askMsg","");
      btn.disabled=false;btn.textContent="PAYMENT DONE ✓";
      const successPanel=$("paymentSuccessPanel"), successDetails=$("paymentSuccessDetails");
      const verifiedQuestionId=String(vr.questionId||pendingQuestionId).trim();
      pendingQuestionId=verifiedQuestionId;
      if(successDetails) successDetails.innerHTML='<b>கேள்வி எண்:</b> '+escapeHtml(verifiedQuestionId)+'<br><b>Payment ID:</b> '+escapeHtml(customerPay)+'<br><b>Payment தேதி & நேரம்:</b> '+escapeHtml(smvDateTime(vr.paymentRecordedAt||new Date()))+'<br><b>நிலை:</b> Waiting for Admin question approval';
      if(successPanel) show("paymentSuccessPanel");
      // Preserve the verified payment details until the customer dashboard is loaded.
      try{
        sessionStorage.setItem("smv_last_payment_success",JSON.stringify({
          customerUid:currentUser?.uid||"",
          questionId:verifiedQuestionId||"",
          paymentId:customerPay||"",
          paymentDate:smvDateTime(vr.paymentRecordedAt||new Date())
        }));
      }catch(_e){}

      pendingQuestionId="";
      // Razorpay checkout closes itself after a successful payment. Do not ask
      // the customer to press a second "Creating Payment" / Continue button.
      // Close the question window immediately after verification, then open the
      // existing Customer Dashboard and show its existing payment-success state.
      try{ if(askFlow.parentElement!==$("dashboardContent")) $("dashboardContent")?.prepend(askFlow); }catch(_e){}
      try{ hide("paymentSuccessPanel"); }catch(_e){}
      try{ window.__SMV_ASK_NOW_INTENT=false; show("dashboard"); show("dashboardContent"); await loadDashboard('customer',true); await showDashboardPaymentSuccess(); window.scrollTo(0,0); }
      catch(dashErr){ console.error("Automatic customer dashboard transition failed:",dashErr); }
      btn.disabled=false; btn.textContent="PAYMENT DONE ✓";
      return;

     }else{throw new Error("Payment verification failed.");}
    }catch(err){const detail=err?.message||String(err)||"Payment verification failed.";message("askMsg",'<span class="error">Payment received, but verification failed.<br><small>'+escapeHtml(detail)+'</small><br>Please retry verification.</span>');btn.disabled=false;btn.textContent="RETRY VERIFICATION";}
   },
   modal:{ondismiss:function(){
     // Closing/backing out of Razorpay is NOT a successful payment.
     // Clear any transient success state and leave the question unpaid.
     try{ sessionStorage.removeItem("smv_last_payment_success"); }catch(_e){}
     message("askMsg",'<span class="small">Payment window closed. No payment was confirmed. Your question is still awaiting payment. You can retry.</span>');
     btn.disabled=false;btn.textContent="கட்டணத்தை மீண்டும் முயற்சிக்கவும்";
   }}
  };
  smvAssertLiveCheckout(options.key);
  const rzp=new Razorpay(options);
  rzp.on("payment.failed",function(resp){
    try{ sessionStorage.removeItem("smv_last_payment_success"); }catch(_e){}
    message("askMsg",'<span class="error">Payment failed: '+escapeHtml(resp.error?.description||"Please try again.")+'</span>');
    btn.disabled=false;btn.textContent="கட்டணத்தை மீண்டும் முயற்சிக்கவும்";
  });
  rzp.open();
 }catch(e){
   const detail=e?.message||e?.details||e?.error?.message||String(e);
   const code=e?.code?` [${escapeHtml(String(e.code))}]`:"";
   console.error("SMV ASTRO payment error",e);
   message("askMsg",'<span class="error"><b>Payment could not be started.</b>'+code+'<br>'+escapeHtml(detail)+'</span>');
   btn.disabled=false;btn.textContent="கட்டணத்தை மீண்டும் முயற்சிக்கவும்";
 }
});

// ---------- Astrologer registration ----------
async function compressPhoto(file){
  if(!file) throw new Error("Profile photo is required.");
  return new Promise((resolve,reject)=>{
    const img=new Image(), reader=new FileReader();
    reader.onload=()=>{img.onload=()=>{const max=320, scale=Math.min(1,max/Math.max(img.width,img.height)); const c=document.createElement('canvas'); c.width=Math.max(1,Math.round(img.width*scale)); c.height=Math.max(1,Math.round(img.height*scale)); c.getContext('2d').drawImage(img,0,0,c.width,c.height); resolve(c.toDataURL('image/jpeg',0.78));}; img.onerror=()=>reject(new Error("Could not read profile photo.")); img.src=reader.result;};
    reader.onerror=()=>reject(new Error("Could not read profile photo.")); reader.readAsDataURL(file);
  });
}
$("astroRegistrationForm")?.addEventListener("submit",async e=>{
 e.preventDefault();const form=e.target,btn=form.querySelector('button[type="submit"]');
 const name=$("arName").value.trim(),mobile=$("arMobile").value.trim(),email=$("arEmail").value.trim(),password=$("arPassword").value,specialization=$("arSpecialization").value.trim(),experience=Number($("arExperience").value||0),bio=$("arBio").value.trim(),bankName=$("arBankName").value.trim(),accountName=$("arAccountName").value.trim(),accountNumber=$("arAccountNumber").value.trim(),ifsc=$("arIfsc").value.trim(),upi=$("arUpi").value.trim(),photoFile=$("arPhoto").files[0];
 if(!name||!mobile||!email||password.length<6||!specialization||experience<0||!bio||!bankName||!accountName||!accountNumber||!ifsc||!photoFile){message("astroRegMsg",'<span class="error">Please complete all required fields.</span>');return;}
 btn.disabled=true;btn.textContent="கணக்கு உருவாக்கப்படுகிறது...";message("astroRegMsg",'<span class="small">உங்கள் கணக்கு உருவாக்கப்படுகிறது...</span>');
 try{
  const photoData=await compressPhoto(photoFile);
  const cred=await withTimeout(createUserWithEmailAndPassword(auth,email,password));const uid=cred.user.uid;
  let profileResponse;
  try {
    profileResponse=await withTimeout(renderApi("/register-astrologer-profile",{
      method:"POST",
      body:JSON.stringify({name,mobile,specialization,experience,bio,bankName,accountName,accountNumber,ifsc,upi,photoData})
    }),30000);
  } catch(networkErr) {
    const raw=String(networkErr?.message||networkErr||"");
    if(/failed to fetch|networkerror|load failed|cors/i.test(raw)) {
      throw new Error("Server connection failed. The Render backend is not reachable right now. Please wait a few seconds and press பதிவைச் சமர்ப்பிக்கவும் again.");
    }
    throw networkErr;
  }
  if(!profileResponse?.ok) throw new Error(profileResponse?.error||"Astrologer profile setup failed.");
  try{await withTimeout(sendEmailVerification(cred.user));}catch(ve){}
  btn.textContent="SAVING PROFILE...";
  form.reset();btn.disabled=false;btn.textContent="SUBMITTED ✓";await signOut(auth);currentUser=null;selectedAstro=null;hide("astro-register-form");hide("register-flow");hide("astro-flow");window.scrollTo({top:0,behavior:"smooth"});openModal('<h2>Registration Complete ✓</h2><p class="success"><b>Your astrologer application has been submitted successfully.</b></p><p><b>Your Astrologer ID: '+escapeHtml(profileResponse.publicId||'')+'</b></p><p>Keep this ID safe for future Astrologer ID login.</p><p>Your verification email has been sent.</p><p><b>நிர்வாகி ஒப்புதலுக்காக காத்திருக்கிறது.</b></p><button class="btn gray" id="astroRegistrationClose">Close</button>');$("astroRegistrationClose").onclick=closeModal;
 }catch(err){let text=err?.message||String(err);if(err?.code==="auth/invalid-email")text="Please enter a correct email ID.";else if(err?.code==="auth/email-already-in-use")text="This email is already registered. Please use Login instead.";else if(err?.code==="auth/operation-not-allowed")text="Email/Password registration is disabled in Firebase Authentication.";else if(err?.code==="auth/network-request-failed")text="Firebase network connection failed. Check your internet connection.";else if(err?.code==="permission-denied")text="Firestore permission denied. Check Firestore Rules.";message("astroRegMsg",'<span class="error"><b>Registration failed:</b> '+escapeHtml(text)+'</span>');btn.disabled=false;btn.textContent="பதிவைச் சமர்ப்பிக்கவும்";}
});
// ---------- Dashboard / admin / session ----------
const SESSION_IDLE_MS = 30 * 60 * 1000;
const SESSION_TOUCH_MS = 30 * 1000;
let idleTimer=null, lastActivity=Date.now(), intentionalLogout=false, lastAuthUid=null;
let dashboardLoadSeq=0;
let dashboardLoadPromise=null;
let dashboardLoadUid=null;
let dashboardSessionGeneration=0;
// Prevent a visible dashboard from being replaced by a second automatic Loading state.
let dashboardShellUid=null;
function touchSession(){ if(!currentUser) return; lastActivity=Date.now(); sessionStorage.setItem('smv_last_activity',String(lastActivity)); }
function clearIdleTimer(){ if(idleTimer){clearTimeout(idleTimer);idleTimer=null;} }
function armIdleTimer(){ clearIdleTimer(); if(!currentUser) return; const tick=()=>{ if(!currentUser)return; const idle=Date.now()-lastActivity; if(idle>=SESSION_IDLE_MS){ logoutToHome('Your session expired after 30 minutes of inactivity.'); return;} idleTimer=setTimeout(tick, Math.min(SESSION_IDLE_MS-idle,60000)); }; idleTimer=setTimeout(tick,60000); }
['click','touchstart','keydown','scroll','pointerdown'].forEach(ev=>window.addEventListener(ev,()=>{ if(currentUser && Date.now()-lastActivity>SESSION_TOUCH_MS) touchSession(); },{passive:true}));
window.addEventListener('pageshow',()=>{ if(currentUser){ touchSession(); armIdleTimer(); } });
window.__smvLogout = logoutToHome;
async function logoutToHome(reason=''){
  ++dashboardSessionGeneration;
  const roleAtLogout=String(sessionStorage.getItem('smv_login_role')||'').toLowerCase();
  const loggingOutAstrologer=roleAtLogout.includes('astrologer') || String(astroDashboardBootstrap?.uid||'')===String(currentUser?.uid||'');
  intentionalLogout=true;
  // Cancel any in-flight Astrologer navigation callback from the previous
  // login before a later Astrologer login can begin. This is the key guard for
  // Astrologer -> Logout -> Astrologer -> Dashboard races.
  if(loggingOutAstrologer) ++smvNavigationEpoch;
  ++dashboardLoadSeq; dashboardLoadPromise=null; dashboardLoadUid=null; clearIdleTimer(); sessionStorage.removeItem('smv_last_activity');
  selectedAstro=null;
  // ASTROLOGER ONLY: clear the previous Astrologer dashboard generation so a
  // later Astrologer login starts clean. Customer/Admin dashboard state is not touched.
  if(loggingOutAstrologer){ astroDashboardBootstrap={uid:null,userData:null,astroData:null}; dashboardReadyUid=null; dashboardReadyRole=null; dashboardShellUid=null; }
  try{ sessionStorage.removeItem("smv_login_role"); }catch(_e){}
  try{await signOut(auth);}catch(e){console.warn("Logout failed",e);}
  currentUser=null;
  window.__smvCurrentUserPresent=false;
  window.__SMV_LOGGED_OUT=true;
  const authButton=$('authBtn');
  if(authButton) authButton.textContent='உள்நுழைவு';
  setTimeout(()=>{if(!auth?.currentUser && $('authBtn')) $('authBtn').textContent='உள்நுழைவு';},300);
  setTimeout(()=>{if(!auth?.currentUser && $('authBtn')) $('authBtn').textContent='உள்நுழைவு';},1200);
  hide('dashboard'); hide('admin'); hide('dashLink'); hide('adminLink');
  setHeaderRoleLabel('');
  hide('ask-flow'); hide('register-flow'); hide('astro-register-form'); hide('astro-flow'); hide('appointment'); hide('contact');
  showHomeSurface();
  show('smv-content-hub');
  show('english-horoscope'); window.__smvContentVisible=false;
  $('authBtn').textContent='உள்நுழைவு'; closeModal(); window.scrollTo({top:0,behavior:'smooth'});
  window.__SMV_LOGGED_OUT=true;
  try{window.dispatchEvent(new Event('smv:logged-out'));}catch(_){ }
  if(reason) alert(reason);
}

async function renderNotifications(targetId){
  const box=$(targetId); if(!box||!currentUser)return;
  try{
    const snap=await withTimeout(getDocs(query(collection(db,'smv_notifications'),where('userId','==',currentUser.uid))),15000);

    /* ================================================================
       SMV ASTRO — CUSTOMER NOTIFICATION LIVE STATUS RECONCILIATION V4
       IMPORTANT: Older payment notifications were created before the
       கேள்வி Approved notification existed and therefore may remain
       stored as "Payment successful / waiting for Admin approval".
       Do NOT depend on an Admin-side updateDoc succeeding. Instead,
       reconcile the notification DISPLAY directly from the canonical
       smv_questions document. This guarantees the Customer Dashboard
       shows the current approval state even when the old notification
       document is immutable or was created without questionId.
       ================================================================ */
    let questionDocs=[];
    try{
      const qs=await withTimeout(getDocs(query(collection(db,'smv_questions'),where('customerId','==',currentUser.uid))),15000);
      questionDocs=qs.docs.map(d=>({id:d.id,data:d.data()||{}}));
    }catch(questionErr){
      console.warn('Customer notification question reconciliation skipped:',questionErr);
    }

    const questionByPayment=new Map();
    const questionById=new Map();
    questionDocs.forEach(item=>{
      const q=item.data||{};
      questionById.set(String(item.id),q);
      if(q.customerPaymentId) questionByPayment.set(String(q.customerPaymentId).trim(),{id:item.id,q});
    });

    const rows=snap.docs.map(d=>{
      const original=d.data()||{};
      const n={...original};
      let related=null;
      const directQid=String(n.questionId||'').trim();
      if(directQid && questionById.has(directQid)) related={id:directQid,q:questionById.get(directQid)};
      if(!related){
        const text=String(n.message||'');
        const match=text.match(/SMV-PAY-[A-Z0-9-]+/i);
        if(match) related=questionByPayment.get(match[0].trim())||null;
      }

      if(related){
        const q=related.q||{};
        const approved=!!q.adminQuestionApprovedAt ||
          ['assigned_to_astrologer','reallocated','available_to_astrologers','claimed_by_astrologer','admin_approved','processing','answer_draft','admin_review','answered'].includes(String(q.status||''));
        const isOldPaymentNotification=
          String(n.type||'').toLowerCase()==='payment_success' ||
          String(n.type||'').toLowerCase()==='payment_verified' ||
          String(n.title||'').toLowerCase().includes('payment successful') ||
          String(n.message||'').toLowerCase().includes('waiting for admin approval');

        const answerSubmitted = !!String(q.answer||'').trim() &&
          ['processing','answer_draft','admin_review','revision_required','answered'].includes(String(q.status||''));
        const answerRejected = String(q.status||'')==='revision_required' || String(q.astrologerAnswerStatus||'')==='revision_required';
        const answerApproved = String(q.status||'')==='answered' || !!q.answerApprovedAt || !!q.adminAnswerApprovedAt;
        const astroName=q.astrologerName||'the selected astrologer';

        /* ============================================================
           CUSTOMER NOTIFICATION STAGE RECONCILIATION
           Canonical stage comes from smv_questions, not the old notification
           text. This fixes old Payment/கேள்வி Approved notifications after
           the astrologer has submitted an answer.
           ============================================================ */
        if(related && answerSubmitted){
          if(answerApproved){
            n.title='பதில் தயாராக உள்ளது';
            n.message='Your astrologer answer has been approved by Admin. Your answer is now ready to view.';
            n.type='answer_ready';
            n.questionId=related.id;
            n.astrologerName=astroName;
            n.__displayTime=q.answerApprovedAt||q.adminAnswerApprovedAt||q.updatedAt||n.updatedAt||n.createdAt||n.dateTime;
          }else if(answerRejected){
            n.title='Answer Rejected — Revise & Resubmit';
            n.message='Admin has rejected the astrologer answer. Please revise and resubmit the answer to the same question.' + (q.adminRejectionReason ? ' Reason: '+String(q.adminRejectionReason) : '');
            n.type='answer_rejected';
            n.questionId=related.id;
            n.astrologerName=astroName;
            n.__displayTime=q.adminRejectedAt||q.updatedAt||n.updatedAt||n.createdAt||n.dateTime;
          }else{
            n.title='ஜோதிடர் பதில் சமர்ப்பிக்கப்பட்டது';
            n.message='Astro '+astroName.replace(/^Astro\s+/i,'')+' has submitted an answer to your question. It is now waiting for Admin approval.';
            n.type='astrologer_answer_submitted';
            n.questionId=related.id;
            n.astrologerName=astroName;
            n.__displayTime=q.answerSubmittedAt||q.updatedAt||n.updatedAt||n.createdAt||n.dateTime;
          }
        }else if(approved && isOldPaymentNotification){
          n.title='கேள்வி Approved';
          n.message='Your question has been approved by Admin and allocated to '+astroName+'.';
          n.type='question_approved';
          n.questionId=related.id;
          n.astrologerName=astroName;
          /* Use the real Admin approval time for ordering/display. */
          n.__displayTime=q.adminQuestionApprovedAt||q.updatedAt||n.updatedAt||n.createdAt||n.dateTime;
        }
      }

      /* ================================================================
   SMV ASTRO — CUSTOMER NOTIFICATION STATUS TIME
   Always use the real timestamp of the current notification status.
   ================================================================ */

if(related){

  const q=related.q||{};

  if(n.type==='question_approved'){

    n.__displayTime =
      q.adminQuestionApprovedAt ||
      q.questionApprovedAt ||
      q.updatedAt ||
      n.updatedAt ||
      n.createdAt ||
      n.dateTime;

  }

  else if(n.type==='astrologer_answer_submitted'){

    n.__displayTime =
      q.answerSubmittedAt ||
      q.astrologerAnswerSubmittedAt ||
      q.updatedAt ||
      n.updatedAt ||
      n.createdAt ||
      n.dateTime;

  }

  else if(n.type==='answer_rejected'){

    n.__displayTime =
      q.adminRejectedAt ||
      q.answerRejectedAt ||
      q.updatedAt ||
      n.updatedAt ||
      n.createdAt ||
      n.dateTime;

  }

  else if(n.type==='answer_ready'){

    n.__displayTime =
      q.answerApprovedAt ||
      q.adminAnswerApprovedAt ||
      q.updatedAt ||
      n.updatedAt ||
      n.createdAt ||
      n.dateTime;

  }

  else{

    n.__displayTime =
      n.updatedAt ||
      n.createdAt ||
      n.dateTime;

  }

}else{

  n.__displayTime =
    n.updatedAt ||
    n.createdAt ||
    n.dateTime;

}
      const ts=n.__displayTime;
      const seconds=Number(ts?.seconds||0);
      const millis=Number(ts?.toMillis?.()||0);
      n.__sort=millis||seconds*1000||(typeof ts==='number'?ts:0);
      return {doc:d,n};
    });

    /* ================================================================
   SMV ASTRO — CUSTOMER NOTIFICATION DEDUPLICATION
   Keep only ONE notification for each கேள்வி + current status.
   பதில் தயாராக உள்ளது and Answer Rejected are deduplicated.
   Other notification types are left unchanged.
   ================================================================ */

const notificationGroups = new Map();

rows.forEach(row => {

  const n = row.n || {};
  const type = String(n.type || '').trim().toLowerCase();

  let key = '';

  if (
    type === 'answer_ready' ||
    type === 'answer_rejected'
  ) {

    const questionId = String(
      n.questionId || ''
    ).trim();

    if (questionId) {
      key = type + '|' + questionId;
    }

  }

  if (!key) return;

  if (!notificationGroups.has(key)) {
    notificationGroups.set(key, []);
  }

  notificationGroups
    .get(key)
    .push(row);
});


const duplicateIds = new Set();

for (const group of notificationGroups.values()) {

  if (group.length <= 1) continue;

  /* Newest notification is kept */
  group.sort((a,b) => {
    return (
      Number(b.n.__sort || 0) -
      Number(a.n.__sort || 0)
    );
  });

  /* Delete older duplicates from display */
  group.slice(1).forEach(row => {

    if (row.doc && row.doc.id) {
      duplicateIds.add(row.doc.id);
    }

  });
}


/* Remove duplicates from the current notification list */
if (duplicateIds.size) {

  rows.splice(
    0,
    rows.length,
    ...rows.filter(row =>
      !duplicateIds.has(row.doc.id)
    )
  );

}


/* Final notification ordering */
rows.sort((a,b) =>
  (Number(b.n.__sort || 0)) -
  (Number(a.n.__sort || 0))
);
    const docs=rows.slice(0,12);
    box.innerHTML=docs.length?docs.map(({n})=>{
      const when=smvDateTime(n.__displayTime||n.createdAt||n.updatedAt||n.dateTime);
      return `<div class="smv-notification-row" style="padding:9px 0;border-bottom:1px solid #eee"><div class="smv-notification-title"><b>${escapeHtml(n.title||'Notification')}</b></div><div class="smv-notification-content">${escapeHtml(n.message||'')}</div><div class="smv-notification-meta"><b>தேதி & நேரம்:</b> ${escapeHtml(when)}</div></div>`;
    }).join(''):'<div class="empty">அறிவிப்புகள் எதுவும் இல்லை.</div>';
  }catch(e){
    console.error('Customer notifications render error:',e);
    box.innerHTML='<div class="empty">அறிவிப்புகள் கிடைக்கவில்லை.</div>';
  }
}
async function showDashboardPaymentSuccess(){
  const box=$("dashboardContent");
  if(!box || !currentUser) return;
  let info=null;
  try{info=JSON.parse(sessionStorage.getItem("smv_last_payment_success")||"null");}catch(_e){}
  if(!info || info.customerUid!==(currentUser?.uid||"") || !info.questionId) return;

  // Never trust sessionStorage alone. It is only a UI hint. Re-read the exact
  // question from Firestore and require the server-written paymentStatus=paid.
  try{
    const qSnap=await withTimeout(getDoc(doc(db,"smv_questions",String(info.questionId))),12000);
    if(!qSnap.exists()){
      sessionStorage.removeItem("smv_last_payment_success");
      return;
    }
    const q=qSnap.data()||{};
    const isPaid=String(q.customerId||"")===String(currentUser.uid||"") && String(q.paymentStatus||"").toLowerCase()==="paid";
    const samePayment=!info.paymentId || String(q.customerPaymentId||"")===String(info.paymentId||"");
    if(!isPaid || !samePayment){
      // Stale/cancelled/failed attempts must never display a success banner.
      sessionStorage.removeItem("smv_last_payment_success");
      return;
    }
  }catch(err){
    console.warn("Payment success banner verification skipped:",err);
    // Fail closed: if we cannot verify the stored success state, do not show it.
    return;
  }

  $("dashboardPaymentSuccessBox")?.remove();
  const card=document.createElement("div");
  card.id="dashboardPaymentSuccessBox";
  card.className="card";
  card.style.cssText="position:relative;margin:0 0 16px 0;border:2px solid #b8860b;background:#fffaf0;";
  card.innerHTML=`<button type="button" aria-label="Close" id="dashboardPaymentSuccessClose" style="position:absolute;right:10px;top:8px;appearance:none;-webkit-appearance:none;border:0!important;background:transparent!important;background-image:none!important;box-shadow:none!important;outline:0!important;padding:0!important;margin:0!important;width:auto!important;min-width:0!important;height:auto!important;font-size:24px;line-height:1;cursor:pointer;color:#000!important">×</button><h3 style="margin-top:0;color:#166534">கட்டணம் வெற்றிகரமாக முடிந்தது ✓</h3><p>உங்கள் கட்டணம் பாதுகாப்பாக சரிபார்க்கப்பட்டது.</p><p><b>உங்கள் பதில் 24 முதல் 48 மணி நேரத்திற்குள் கிடைக்கும்.</b></p>${info.questionId?`<div class="small"><b>கேள்வி எண்:</b> ${escapeHtml(info.questionId)}</div>`:""}${info.paymentId?`<div class="small"><b>Payment ID:</b> ${escapeHtml(info.paymentId)}</div>`:""}`;
  box.insertBefore(card,box.firstChild);
  $("dashboardPaymentSuccessClose")?.addEventListener("click",()=>{card.remove();try{sessionStorage.removeItem("smv_last_payment_success");}catch(_e){}});
}

let smvQuestionWatch=null,smvWatchUid=null;
function smvWatchQuestions(role){
 const uid=currentUser?.uid;if(!uid||smvWatchUid===uid)return;
 smvQuestionWatch?.();smvWatchUid=uid;let first=true;
 smvQuestionWatch=onSnapshot(query(collection(db,'smv_questions'),where(role==='astrologer'?'astrologerId':'customerId','==',uid)),()=>{
   if(first){first=false;return;} dashboardReadyAt=0;
   if(currentUser?.uid!==uid)return;
   const button=document.getElementById('smvRefreshDashboard');
   if(smvInternalView==='dashboard' && !document.querySelector('#dashboard [data-smv-dirty],#dashboard input:focus,#dashboard textarea:focus'))setTimeout(()=>loadDashboard(role,true),200);
   if(button)button.textContent="\u0baa\u0bc1\u0ba4\u0bbf\u0baf \u0ba4\u0b95\u0bb5\u0bb2\u0bcd \u0b89\u0bb3\u0bcd\u0bb3\u0ba4\u0bc1 \u2014 \u0baa\u0bc1\u0ba4\u0bc1\u0baa\u0bcd\u0baa\u0bbf";
 },e=>console.warn('Live dashboard updates unavailable:',e));
}
window.__smvRefreshDashboard=()=>{
 if(!currentUser)throw new Error('Please login again.');
 smvInternalView='dashboard'; dashboardReadyAt=0;
 hidePrimarySections('dashboard');show('dashboard');show('dashboardContent');
 return loadDashboard(dashboardReadyRole||null,true);
};
window.addEventListener('smv:logged-out',()=>{smvQuestionWatch?.();smvQuestionWatch=null;smvWatchUid=null;dashboardReadyAt=0;});
async function loadDashboard(expectedRole=null,force=false){
 const box=$('dashboardContent');
 if(!currentUser){ if(box) box.innerHTML='<div class="card">Please login to continue.</div>'; return; }
 const loadUid=currentUser.uid;
 const loadGeneration=dashboardSessionGeneration;
 const requestedRole=String(expectedRole||'').toLowerCase();
 // IMPORTANT: Returning from ASK NOW must not rehydrate an already-rendered
 // dashboard. The old behaviour started another full Firestore load every time
 // the கேள்வி Form Back button was pressed, which could create a repeated
 // Loading -> open -> Loading cycle. Explicit data-changing actions can pass
 // force=true when a fresh render is actually required.
 if(!force && Date.now()-dashboardReadyAt<15000 && dashboardReadyUid===loadUid && (!requestedRole || dashboardReadyRole===requestedRole) && smvInternalView==='dashboard' && box && !box.querySelector('.error')){
   show('dashboard');
   touchSession();
   armIdleTimer();
   return;
 }
 // A forced refresh is used after Claim and after Answer/Edit submission.
 // It must be allowed to start a genuinely new dashboard load even when a
 // previous load promise for the same user has already completed.
 if(force){
   ++dashboardLoadSeq;
   dashboardLoadPromise=null;
   dashboardLoadUid=null;
 }
 // Deduplicate only non-forced concurrent calls. A second normal caller must
 // share the active promise instead of starting another Firestore load.
 if(!force && dashboardLoadPromise && dashboardLoadUid===loadUid) return dashboardLoadPromise;
 const loadId=++dashboardLoadSeq;
 const active=()=>loadId===dashboardLoadSeq && loadGeneration===dashboardSessionGeneration && !!currentUser && currentUser.uid===loadUid && smvInternalView==='dashboard';
 dashboardLoadUid=loadUid;
 dashboardLoadPromise=(async()=>{
 try{
  // Auth router owns the visible role shell; hydration never replaces it with Loading.
  if(active() && dashboardShellUid!==loadUid) dashboardShellUid=loadUid;
  // ASTROLOGER ONLY: reuse the profile already fetched by login/auth. This removes
  // the duplicate smv_users read that made a second Astrologer login feel stuck.
  let u=null, a0=null;
  const useAstroCache=requestedRole==='astrologer' && astroDashboardBootstrap.uid===loadUid;
  if(useAstroCache){
    u={exists:()=>!!astroDashboardBootstrap.userData,data:()=>astroDashboardBootstrap.userData||{}};
    if(astroDashboardBootstrap.astroData){
      a0={exists:()=>true,data:()=>astroDashboardBootstrap.astroData||{}};
    }else{
      a0=await withTimeout(getDoc(doc(db,'smv_astrologers',loadUid)),8000).catch(()=>null);
      if(a0?.exists()) astroDashboardBootstrap.astroData=a0.data()||{};
    }
  }else{
    const userPromise = withTimeout(getDoc(doc(db,'smv_users',loadUid)),10000);
    const astroPromise = withTimeout(getDoc(doc(db,'smv_astrologers',loadUid)),10000).catch(()=>null);
    [u,a0] = await Promise.all([userPromise, astroPromise]);
  }
  const data=u?.exists()?u.data():{};
  if(!active()) return;
   let role=String(expectedRole||data.role||'').toLowerCase();
   let preloadedAstro={};
   if(a0 && a0.exists()){
     preloadedAstro=a0.data()||{};
     if(!expectedRole && role!=='astrologer') role='astrologer';
   }
   if(role!=='customer' && role!=='astrologer') role='customer';
   if(!active()) return;
   // Keep one stable dashboard heading during loading and after role resolution.
   // The role is already shown by the role badge/content; changing the heading
   // during async loading makes Customer/Astrologer dashboards appear to
   // interact or flash before the final dashboard is rendered.
   $('dashboardTitle').textContent='Dashboard';
   if(role==='astrologer'){
   let ad=preloadedAstro||{};

/* Use the profile already loaded above. This avoids a second Firestore
   read every time the Astrologer Dashboard opens. */
if(preloadedAstro && Object.keys(preloadedAstro).length){
  ad=preloadedAstro;
}

const userStatus=String(
  data.status||ad.status||'pending'
).toLowerCase();
   const astroStatus=String(ad.status||data.status||'pending').toLowerCase();
 
   if(!['active','approved'].includes(astroStatus)){
  const astroId=data.publicId||ad.publicId||'';
  const isRejected=['rejected','declined','admin_rejected'].includes(astroStatus);

  if(isRejected){
    const rejectionReason=
      ad.rejectionReason||
      data.rejectionReason||
      'Your astrologer application was rejected by Admin.';

    box.innerHTML=`<div class="card" style="max-width:900px;margin:0 auto">
      <h2>Astrologer Dashboard</h2>

      <div class="card" style="border:2px solid #c62828;background:#fff5f5">
        <h3 style="margin-top:0;color:#b71c1c">
          ❌ Astrologer Application Rejected
        </h3>

        <p>Your astrologer application has been rejected by Admin.</p>

        ${astroId?`<p><b>Astrologer ID:</b> ${escapeHtml(astroId)}</p>`:''}

        <p><b>Application நிலை:</b> Rejected</p>

        <p>
          <b>Admin Reason:</b>
          ${escapeHtml(rejectionReason)}
        </p>

        <p class="small">
          Your astrologer dashboard features are unavailable while the application is rejected.
        </p>
      </div>

      <div class="action-row">
        <button class="btn gray" id="astroRefreshApproval">
          REFRESH STATUS
        </button>

        <button class="btn" id="astroLogoutPending">
          LOGOUT
        </button>
      </div>
    </div>`;
  }else{
    box.innerHTML=`<div class="card" style="max-width:900px;margin:0 auto">
      <h2>Astrologer Dashboard</h2>

      <div class="card" style="border:2px solid var(--gold);background:#fffaf0">
        <h3 style="margin-top:0">
          ⏳ நிர்வாகி ஒப்புதலுக்காக காத்திருக்கிறது
        </h3>

        <p>
          Your astrologer account and professional profile have been registered successfully.
        </p>

        ${astroId?`<p><b>Astrologer ID:</b> ${escapeHtml(astroId)}</p>`:''}

        <p>
          <b>Application நிலை:</b>
          Pending நிர்வாகி ஒப்புதல்
        </p>

        <p class="small">
          You can login and view this status now.
          Customer questions, answering, earnings and withdrawals
          will become available after Admin approval.
        </p>
      </div>

      <div class="action-row">
        <button class="btn gray" id="astroRefreshApproval">
          REFRESH STATUS
        </button>

        <button class="btn" id="astroLogoutPending">
          LOGOUT
        </button>
      </div>
    </div>`;
  }

  $('astroRefreshApproval')?.addEventListener(
    'click',
    ()=>loadDashboard()
  );

  $('astroLogoutPending')?.addEventListener(
    'click',
    ()=>logoutToHome()
  );

  return;
}
   // One Firestore question query is enough for both the Public கேள்வி Inbox
   // and the astrologer's own queue. The previous code queried the exact same
   // collection twice, sequentially, which could add another 12 seconds to the
   // dashboard startup on a slow connection.
   let qs={docs:[]};
   let withdrawalSnap={docs:[]};
   try{
     const [questionSnap,withdrawalSnapFast]=await Promise.all([
       withTimeout(getDocs(query(collection(db,'smv_questions'),where('astrologerId','==',currentUser.uid))),10000).catch(e=>{console.warn('Astrologer questions query skipped:',e);return {docs:[]};}),
       withTimeout(getDocs(query(collection(db,'smv_withdrawals'),where('astrologerId','==',currentUser.uid))),8000).catch(e=>{console.warn('Astrologer withdrawals query skipped:',e);return {docs:[]};})
     ]);
     qs=questionSnap||{docs:[]};
     withdrawalSnap=withdrawalSnapFast||{docs:[]};
   }catch(e){ console.warn('Astrologer dashboard primary data load skipped:',e); }
   const availableQuestions=qs.docs.filter(d=>{const q=d.data()||{};return q.astrologerId===currentUser.uid&&!!q.adminQuestionApprovedAt&&['assigned_to_astrologer','available_to_astrologers','reallocated'].includes(String(q.allocationStatus||''))&&['admin_approved','paid'].includes(String(q.status||''));}).map(d=>({id:d.id,...d.data()}));
   // Astrologer question lists: newest first.
   availableQuestions.sort((a,b)=>smvQuestionSortTime(b)-smvQuestionSortTime(a));
   const activeQuestions=qs.docs.filter(d=>{const q=d.data()||{};const st=String(q.status||'');const al=String(q.allocationStatus||'');const hasAnswer=!!String(q.answer||'').trim();const isPublicAvailable=['paid','admin_approved'].includes(st)&&['assigned_to_astrologer','available_to_astrologers','reallocated'].includes(al)&&!!q.adminQuestionApprovedAt;const isClaimedUnanswered=st==='admin_approved'&&al==='claimed_by_astrologer'&&(!hasAnswer||q.astrologerEditMode===true);return q.astrologerId===currentUser.uid&&(isPublicAvailable||isClaimedUnanswered);});
   const approved=ad.status==='approved';
  // Earnings and withdrawals are optional dashboard data. Load them in
  // parallel so neither one can unnecessarily hold up the other. The critical
  // question queue is already available from the single Firestore query above.
  let totalEarnings = 0;
  let ledger = [];
  // Do not hold first dashboard paint on the Render earnings endpoint.
  // Firestore question data is already available and is sufficient to show the
  // earnings/ledger immediately. The canonical endpoint is refreshed in the
  // background and can update the dashboard later if needed.
  const fallbackEarningsDocs=qs.docs.filter(d=>{
    const q=d.data()||{};
    return q.astrologerId===currentUser.uid && q.status==='answered' && q.commissionStatus==='credited';
  });
  const fallbackLedger=fallbackEarningsDocs.map(d=>{
    const q=d.data()||{};
    return {id:d.id,question:q.question||'ஆலோசனை',commission:Number(q.astrologerCommissionAmount||q.commissionAmount||0),date:q.commissionCreditedAt||q.answerApprovedAt||q.adminAnswerApprovedAt||null};
  });
  totalEarnings=fallbackLedger.reduce((sum,x)=>sum+Number(x.commission||0),0);
  ledger=fallbackLedger;
  if(!active()) return;

  let reservedWithdrawals = 0;
  let totalWithdrawals = 0;
  let latestWithdrawalAt = null;
  withdrawalSnap.docs.forEach(d => {
    const w = d.data() || {};
    const st = String(w.status || 'pending').toLowerCase();
    const amount = Number(w.amount || 0);
    if (['pending','processing','paid'].includes(st)) {
      reservedWithdrawals += amount;
      totalWithdrawals += amount;
      const raw = w.createdAt || w.requestedAt || w.paidAt || null;
      const ms = raw?.toMillis ? raw.toMillis() : (raw instanceof Date ? raw.getTime() : Number(raw || 0));
      if (ms && (!latestWithdrawalAt || ms > latestWithdrawalAt)) latestWithdrawalAt = ms;
    }
  });

  const availableToWithdraw = Math.max(0, Math.round((totalEarnings - reservedWithdrawals) * 100) / 100);
  const minimumWithdrawal = 300;
  const WITHDRAWAL_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
  const withdrawalCooldownActive = !!latestWithdrawalAt && (Date.now() - latestWithdrawalAt < WITHDRAWAL_COOLDOWN_MS);
  const withdrawalEligible = availableToWithdraw >= minimumWithdrawal && !withdrawalCooldownActive;
  const withdrawalCooldownEndsAt = withdrawalCooldownActive ? latestWithdrawalAt + WITHDRAWAL_COOLDOWN_MS : null;

  const ep = {totalEarnings,totalWithdrawals,availableToWithdraw,minimumWithdrawal,withdrawalCooldownActive,withdrawalCooldownEndsAt,withdrawalEligible,ledger};
   if(!active()) return;
   box.innerHTML=`<div class="grid astro-dashboard-summary">
    <div class="card astro-profile-summary-card">
      <div class="astro-profile-photo">${ad.photoData?`<img src="${ad.photoData}" alt="${escapeHtml(data.name||'Astrologer')}" loading="lazy">`:''}</div>
      <div class="astro-profile-info">
        <h3><span translate="no">${escapeHtml(data.name||'')}</span></h3>
        <p>${['approved','active'].includes(String(ad.status||data.status||'').toLowerCase()) ? '<span class="smv-approved-badge"><span class="smv-check">✓</span><span>Approved</span></span>' : '<b>நிலை:</b> ' + escapeHtml(ad.status||'pending')}</p>
        <p><b>${escapeHtml(ad.expertise||ad.specialization||'Astrology')}</b></p>
        <p>${escapeHtml(ad.experience||0)} years experience</p>
        <p class="astro-profile-bio">${escapeHtml(ad.bio||ad.about||'')}</p>
      </div>
    </div>
    <div class="card"><h3>என் கேள்விகள்</h3><p><b>${activeQuestions.length}</b> active question(s)</p><p>Approved profile: <b>${
  ad.status === 'approved'
    ? 'அங்கீகரிக்கப்பட்டது'
    : ad.status === 'rejected'
      ? 'நிராகரிக்கப்பட்டது'
      : 'நிர்வாக அனுமதிக்காக காத்திருக்கிறது'
}</b></p>
${ad.status === 'rejected' && ad.rejectionReason
  ? `<p class="error"><b>Rejection Reason:</b> ${escapeHtml(ad.rejectionReason)}</p>`
  : ''}</div>
    <div class="card"><h3>மொத்த வருமானம்</h3><p style="font-size:28px"><b class="smv-earnings-total ${Number(ep.totalEarnings||0)>=300?'is-green':''}">₹${Number(ep.totalEarnings||0).toFixed(2)}</b></p><p>மொத்தத் தொகைத் திரும்பப் பெறுதல்: <b>₹${Number(ep.totalWithdrawals||0).toFixed(2)}</b></p><p>திரும்பப் பெறக்கூடிய தொகை: <b class="smv-earnings-available ${Number(ep.availableToWithdraw||0)>=300?'is-green':'is-red'}">₹${Number(ep.availableToWithdraw||0).toFixed(2)}</b></p><p class="small">குறைந்தபட்சத் தொகைத் திரும்பப் பெறுதல்: ₹${Number(ep.minimumWithdrawal||300).toFixed(2)}</p>${ep.withdrawalCooldownActive ? `<p class="smv-withdraw-locked"><b>🔒 Withdrawal locked for 7 days after the last withdrawal request.</b><br><span class="small">Available again: ${escapeHtml(smvDateTime(new Date(ep.withdrawalCooldownEndsAt)))}</span></p><button class="btn smv-withdraw-btn is-red" id="withdrawBtn" disabled>WITHDRAW</button>` : ep.withdrawalEligible ? '<p class="smv-withdraw-ready"><b>✓ You can withdraw</b></p><button class="btn smv-withdraw-btn is-green" id="withdrawBtn">WITHDRAW</button>' : '<p class="smv-withdraw-locked"><b>Reach ₹300 to request a withdrawal.</b></p><button class="btn smv-withdraw-btn is-red" id="withdrawBtn" disabled>WITHDRAW</button>'}</div>
   </div>
   <div class="card" style="margin-top:16px"><h3>பொது கேள்விப் பெட்டி</h3><p class="small">நிர்வாகி உங்களுக்கு ஒதுக்கிய பிறப்பு விவரங்களும் கேள்விக் கட்டணமும் கொண்ட கிடைக்கக்கூடிய கேள்விகள் இங்கே காட்டப்படும்.</p>${!approved?'<div class="empty">Your astrologer profile must be approved by Admin before you can claim questions.</div>':availableQuestions.length?availableQuestions.slice(0,50).map(q=>`<div class="card" style="margin:10px 0"><b><span translate="no">${escapeHtml(q.question||'கேள்வி')}</span></b><div class="small"><b>பிறப்பு விவரங்கள்:</b> ${escapeHtml(q.birthName||q.birthDetails?.name||'')} · ${escapeHtml(q.birthDate||q.birthDetails?.birthDate||'')} · ${escapeHtml(q.birthTime||q.birthDetails?.birthTime||'')} · ${escapeHtml(q.birthPlace||q.birthDetails?.birthPlace||'')} · ${escapeHtml(q.birthGender||q.birthDetails?.birthGender||'')}</div><div class="small"><b>கேள்வி எண்: ${escapeHtml(q.id||'')}</b> · <b>தேதி & நேரம்:</b> ${escapeHtml(smvDateTime(q.createdAt||q.paymentRecordedAt||q.updatedAt))}</div><div class="small"><b>கேள்வி Price: ₹${Number(q.astrologerCommissionAmount||0).toFixed(2)}</b></div><button class="btn" data-claim-question="${q.id}">CLAIM & ANSWER</button></div>`).join(''):'<div class="empty">தற்போது பணம் செலுத்தப்பட்ட பொது கேள்விகள் எதுவும் இல்லை.</div>'}</div>
<div class="card" id="astroQuestionQueue" style="margin-top:16px">
  <h3>கேள்விகள் — பதிலளிக்கப்படாத வரிசை</h3>
  <p class="small">உங்களுக்காகப் பெறப்பட்டு, உங்கள் பதிலுக்காகக் காத்திருக்கும் கேள்விகள் இங்கே காட்டப்படும்.</p>
  ${qs.docs.filter(d=>{const q=d.data()||{};return q.astrologerId===currentUser.uid && String(q.status||'')==='admin_approved' && String(q.allocationStatus||'')==='claimed_by_astrologer' && (!String(q.answer||'').trim() || q.astrologerEditMode===true);}).length ? qs.docs.filter(d=>{const q=d.data()||{};return q.astrologerId===currentUser.uid && String(q.status||'')==='admin_approved' && String(q.allocationStatus||'')==='claimed_by_astrologer' && (!String(q.answer||'').trim() || q.astrologerEditMode===true);}).slice().sort((a,b)=>smvQuestionSortTime(b.data()||{})-smvQuestionSortTime(a.data()||{})).map(d=>{const q=d.data()||{};const minWords=Number(q.answerMinWords||150);const birthName=q.birthName||q.birthDetails?.name||'';const birthDate=q.birthDate||q.birthDetails?.birthDate||'';const birthTime=q.birthTime||q.birthDetails?.birthTime||'';const birthPlace=q.birthPlace||q.birthDetails?.birthPlace||'';const birthGender=q.birthGender||q.birthDetails?.birthGender||'';const questionPrice=Number(q.astrologerCommissionAmount||0);return `<div class="card astro-question-item" style="margin:10px 0" data-question-card="${escapeHtml(d.id)}"><div class="badge">${q.astrologerEditMode===true?'திருத்தம் அவசியம்':'பதிலளிக்கப்படவில்லை'}</div><h3 style="margin-top:8px"><span translate="no">${escapeHtml(q.question||'கேள்வி')}</span></h3><div class="small"><b>பிறப்பு விவரங்கள்:</b> ${escapeHtml(birthName)} · ${escapeHtml(birthDate)} · ${escapeHtml(birthTime)} · ${escapeHtml(birthPlace)} · ${escapeHtml(birthGender)}</div><div class="small"><b>கேள்வி எண்:</b> ${escapeHtml(d.id)} · <b>தேதி & நேரம்:</b> ${escapeHtml(smvDateTime(q.updatedAt||q.adminQuestionApprovedAt||q.createdAt))} · <b>கேள்வி Price:</b> ₹${questionPrice.toFixed(2)} · <b>Minimum:</b> ${minWords} words</div><textarea id="ans_${d.id}" data-answer-protected="true" placeholder="குறைந்தது ${minWords} சொற்களை எழுதவும்...">${escapeHtml(q.answer||'')}</textarea><div class="small" id="count_${d.id}">0 / ${minWords} சொற்கள்</div><button class="btn" data-answer="${d.id}">${q.astrologerEditMode===true?'நிர்வாகி அங்கீகாரத்திற்காக மீண்டும் சமர்ப்பிக்கவும்':'நிர்வாகி அங்கீகாரத்திற்குச் சமர்ப்பிக்கவும்'}</button></div>`;}).join('') : '<div class="empty">பதிலளிக்கப்படாத கேள்விகள் எதுவும் காத்திருக்கவில்லை.</div>'}
</div>
<div class="card" id="astroAnsweredBox" style="margin-top:16px">
  <h3>பதில்கள் — பதிலளிக்கப்பட்ட கேள்விகள்</h3>
  <p class="small">சமர்ப்பிக்கப்பட்ட பதில்கள் நிர்வாகி அங்கீகரிக்கும் வரை இங்கே இருக்கும். அங்கீகரிக்கப்பட்ட பதில்கள் இறுதியானவை; நிராகரிக்கப்பட்ட பதில்கள் திருத்தி மீண்டும் சமர்ப்பிக்க அதே ஜோதிடரிடம் திரும்பும்.</p>
  ${qs.docs.filter(d=>{const q=d.data()||{};return q.astrologerId===currentUser.uid && !!String(q.answer||'').trim() && ['processing','answer_draft','admin_review','revision_required','answered'].includes(String(q.status||''));}).length ? qs.docs.filter(d=>{const q=d.data()||{};return q.astrologerId===currentUser.uid && !!String(q.answer||'').trim() && ['processing','answer_draft','admin_review','revision_required','answered'].includes(String(q.status||''));}).slice().sort((a,b)=>smvQuestionSortTime(b.data()||{})-smvQuestionSortTime(a.data()||{})).map(d=>{const q=d.data()||{};const rejected=q.status==='revision_required'||q.astrologerAnswerStatus==='revision_required';const approved=q.status==='answered';const status=approved?'பதிலளிக்கப்பட்டது':(rejected?'திருத்தம் அவசியம்':'நிர்வாகி ஒப்புதலுக்காக காத்திருக்கிறது');const birthName=q.birthName||q.birthDetails?.name||'';const birthDate=q.birthDate||q.birthDetails?.birthDate||'';const birthTime=q.birthTime||q.birthDetails?.birthTime||'';const birthPlace=q.birthPlace||q.birthDetails?.birthPlace||'';const birthGender=q.birthGender||q.birthDetails?.birthGender||'';const note=approved?'':(rejected?`<div class="small pending-note" style="margin-top:6px">நிர்வாகி திருத்தம் கோரியுள்ளார்.${q.adminRejectionReason?' '+escapeHtml(q.adminRejectionReason):''}</div>`:'<div class="small pending-note" style="margin-top:6px">உங்கள் பதில் நிர்வாகி ஒப்புதலுக்காக காத்திருக்கிறது. ஒப்புதல் கிடைக்கும் வரை திருத்தி மீண்டும் சமர்ப்பிக்கலாம்.</div>');const editButton=approved?'':`<button class="btn" data-edit-answer="${escapeHtml(d.id)}">திருத்தி மீண்டும் சமர்ப்பிக்கவும்</button>`;return `<div class="card astro-answer-item ${rejected?'revision-required':''} ${approved?'answer-approved':''}" style="margin:10px 0"><div class="badge">${status}</div>${note}<h3 style="margin-top:8px"><span translate="no">${escapeHtml(q.question||'கேள்வி')}</span></h3><div class="small"><b>பிறப்பு விவரங்கள்:</b> ${escapeHtml(birthName)} · ${escapeHtml(birthDate)} · ${escapeHtml(birthTime)} · ${escapeHtml(birthPlace)} · ${escapeHtml(birthGender)}</div><div class="small"><b>கேள்வி எண்:</b> ${escapeHtml(d.id)} · <b>தேதி & நேரம்:</b> ${escapeHtml(smvDateTime(q.answerApprovedAt||q.updatedAt||q.answerSubmittedAt||q.createdAt))}</div><div style="margin-top:10px;white-space:pre-wrap;line-height:1.65"><span translate="no">${escapeHtml(q.answer||'')}</span></div><div class="small" style="margin-top:8px"><b>நிலை:</b> ${escapeHtml(status)}</div>${editButton}</div>`;}).join('') : '<div class="empty">இதுவரை சமர்ப்பிக்கப்பட்ட பதில்கள் இல்லை.</div>'}
</div>
<div class="card" style="margin-top:16px"><h3>வருமான வரலாறு</h3>${ep.ledger?.length?ep.ledger.slice().sort((a,b)=>smvSortMillis(b.date||b.createdAt||b.updatedAt)-smvSortMillis(a.date||a.createdAt||a.updatedAt)).slice(0,50).map(x=>`<div class="smv-history-row" style="padding:10px 0;border-bottom:1px solid #eee"><div class="smv-history-amount"><b>₹${Number(x.commission||0).toFixed(2)}</b> · <span class="success">Earning Credited</span></div><div class="smv-history-content">${escapeHtml(x.question||'ஆலோசனை')}</div><div class="smv-history-detail"><b>தேதி & நேரம்:</b> ${escapeHtml(smvDateTime(x.date))}</div><div class="smv-history-detail"><b>கேள்வி எண்:</b> ${escapeHtml(x.id||'')}</div></div>`).join(''):'<div class="empty">இதுவரை வரவு வைக்கப்பட்ட வருமானம் இல்லை.</div>'}<div class="withdrawal-history-section" style="margin-top:14px;padding-top:10px;border-top:1px solid #eee"><div class="withdrawal-history-title">தொகைத் திரும்பப் பெறுதல் வரலாறு</div>${withdrawalSnap?.docs?.length?withdrawalSnap.docs.slice().sort((a,b)=>Number(b.data().createdAt?.seconds||0)-Number(a.data().createdAt?.seconds||0)).slice(0,20).map(d=>{const w=d.data()||{};const st=String(w.status||'pending').toLowerCase();const cls=st==='paid'?'success':st==='rejected'?'error':st==='processing'?'small':'small';const label=st==='paid'?'செலுத்தப்பட்டது':st==='processing'?'செயலாக்கத்தில் உள்ளது':st==='rejected'?'நிராகரிக்கப்பட்டது':'நிலுவையில் உள்ளது';return `<div class="smv-history-row smv-withdrawal-row" style="padding:10px 0;border-bottom:1px solid #eee"><div class="smv-history-amount"><b>₹${Number(w.amount||0).toFixed(2)}</b> · <span class="${cls}">${label}</span></div><div class="smv-history-detail"><b>Withdrawal ID:</b> ${escapeHtml(w.withdrawalId||'—')}</div>${st==='paid' && /^SMV-PMT-/.test(String(w.adminPaymentId||'')) ? '<div class="small"><b>Admin Payment ID:</b> '+escapeHtml(w.adminPaymentId)+'</div>' : ''}<div class="small"><b>Requested:</b> ${escapeHtml(smvDateTime(w.createdAt||w.requestedAt))}${st==='paid' && w.paidAt ? '<br><b>Paid தேதி & நேரம்:</b> '+escapeHtml(smvDateTime(w.paidAt)) : ''}</div></div>`}).join(''):'<div class="small">இதுவரை தொகைத் திரும்பப் பெறும் கோரிக்கைகள் இல்லை.</div>'}</div></div>
<div class="card" style="margin-top:16px"><h3>கட்டண முறை</h3><p class="small">Your bank/UPI details are private. Full details are not displayed again.</p><button class="btn gray" id="changePayoutBtn2">கட்டண முறையை மாற்றவும்</button></div>`;
  document.querySelectorAll('[data-claim-question]').forEach(b=>b.onclick=async()=>{
  const questionId=String(b?.dataset?.claimQuestion || b?.getAttribute?.('data-claim-question') || '').trim();
  if(!questionId){ alert('Question ID is missing. Please refresh and try again.'); return; }
  if(!currentUser){ alert('Please login again.'); return; }

  b.disabled=true;
  b.textContent='CLAIMING...';
  try{
    // Claim/status write is performed by the Tamil Render backend using the
    // Firebase Admin SDK. This avoids Firestore client-rule permission errors.
    await renderApi('/astrologer/claim-question',{
      method:'POST',
      body:JSON.stringify({questionId})
    });

    await loadDashboard('astrologer', true);
    requestAnimationFrame(()=>{
      setTimeout(()=>{
        const answerBox=$('ans_'+questionId);
        if(answerBox){
          answerBox.style.minHeight='400px'; answerBox.style.height='400px'; answerBox.style.maxHeight='none'; answerBox.style.resize='vertical';
          answerBox.focus(); answerBox.scrollIntoView({behavior:'smooth',block:'center'});
        } else {
          $('astroQuestionQueue')?.scrollIntoView({behavior:'smooth',block:'start'});
        }
      },100);
    });
  }catch(e){
    console.error('கேள்வி claim error:',e);
    alert(e?.message||String(e));
    b.disabled=false;
    b.textContent='CLAIM & ANSWER';
  }
});

   // Answer-box paste protection: use event delegation because answer textareas are
   // created/re-rendered dynamically after the dashboard loads. This ensures the
   // protection works even when a question is opened or claimed later.
   const isProtectedAnswerBox = (el) => !!(el && el.matches && el.matches('textarea[data-answer-protected="true"]'));
   const showClipboardBlocked = () => smvNotice(
     'Clipboard Not Allowed',
     'For security, answers must be typed directly into the answer box. Copy, cut and paste are not allowed.',
     '🔒'
   );

   document.addEventListener('paste', (e) => {
     if (isProtectedAnswerBox(e.target)) {
       e.preventDefault();
       e.stopPropagation();
       showClipboardBlocked();
       return false;
     }
   }, true);

   document.addEventListener('dragover', (e) => {
      if (isProtectedAnswerBox(e.target)) {
        e.preventDefault(); e.stopPropagation();
      }
    }, true);
    document.addEventListener('drop', (e) => {
     if (isProtectedAnswerBox(e.target)) {
       e.preventDefault();
       e.stopPropagation();
       showClipboardBlocked();
       return false;
     }
   }, true);

   document.addEventListener('beforeinput', (e) => {
     if (isProtectedAnswerBox(e.target) && (e.inputType === 'insertFromPaste' || e.inputType === 'insertFromDrop' || e.inputType === 'insertFromPasteAsQuotation')) {
       e.preventDefault();
       e.stopPropagation();
       showClipboardBlocked();
     }
   }, true);

   document.addEventListener('keydown', (e) => {
     if (isProtectedAnswerBox(e.target) && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
       e.preventDefault();
       e.stopPropagation();
       showClipboardBlocked();
     }
   }, true);

   // Block the context menu only on the protected answer box; normal dashboard
   // context menus remain untouched elsewhere.
   document.addEventListener('copy', (e) => {
     if (isProtectedAnswerBox(e.target)) {
       e.preventDefault();
       e.stopPropagation();
       showClipboardBlocked();
     }
   }, true);

   document.addEventListener('cut', (e) => {
     if (isProtectedAnswerBox(e.target)) {
       e.preventDefault();
       e.stopPropagation();
       showClipboardBlocked();
     }
   }, true);

   document.addEventListener('contextmenu', (e) => {
     if (isProtectedAnswerBox(e.target)) e.preventDefault();
   }, true);

   // Re-open a submitted/rejected answer in the கேள்வி Box for editing.
   document.querySelectorAll('[data-edit-answer]').forEach(b=>{
     b.onclick=async()=>{
       const questionId=b.dataset.editAnswer;
       if(!currentUser){ alert('Please login again.'); return; }
       b.disabled=true; b.textContent='OPENING EDIT...';
       try{
         const result=await renderApi('/astrologer/edit-answer',{method:'POST',body:JSON.stringify({questionId})});
         if(!result?.success) throw new Error(result?.error||'Unable to open answer for editing.');
         await loadDashboard('astrologer',true);
         requestAnimationFrame(()=>setTimeout(()=>{
           const answerBox=$('ans_'+questionId);
           if(answerBox){ answerBox.style.minHeight='400px'; answerBox.style.height='400px'; answerBox.style.maxHeight='none'; answerBox.style.resize='vertical'; answerBox.focus(); answerBox.scrollIntoView({behavior:'smooth',block:'center'}); }
           else $('astroQuestionQueue')?.scrollIntoView({behavior:'smooth',block:'start'});
         },120));
       }catch(e){
         console.error('Answer edit error:',e); alert(e.message||String(e)); b.disabled=false; b.textContent='திருத்தி மீண்டும் சமர்ப்பிக்கவும்';
       }
     };
   });

   document.querySelectorAll('[data-answer]').forEach(b => {

  const questionId = b.dataset.answer;
  const textarea = $('ans_' + questionId);

  b.onclick = async () => {

    const answer = textarea?.value.trim();

    if (!answer) {
      alert('Please write an answer.');
      return;
    }

    b.disabled = true;
    b.textContent = 'சமர்ப்பிக்கப்படுகிறது...';

    try {

      const questionRef =
        doc(db, 'smv_questions', questionId);

      const snap = await withTimeout(
        getDoc(questionRef),
        15000
      );

      if (!snap.exists()) {
        throw new Error('கேள்வி not found.');
      }

      const q = snap.data();

      if (!currentUser) {
        throw new Error('Please login again.');
      }

      if (q.astrologerId !== currentUser.uid) {
        throw new Error(
          'This question is not assigned to you.'
        );
      }

      // The answer remains editable until Admin approval. After approval the
      // dashboard no longer renders an editable textarea.
      if (
        q.status !== 'admin_approved' &&
        q.status !== 'revision_required' &&
        q.status !== 'processing' &&
        q.status !== 'admin_review'
      ) {
        throw new Error(
          'This answer can no longer be edited.'
        );
      }

      const minWords =
        Number(q.answerMinWords || 150);

      const wordCount =
        answer
          .split(/\s+/)
          .filter(Boolean)
          .length;

      if (wordCount < minWords) {
        throw new Error(
          `Please write at least ${minWords} words.`
        );
      }

      const commissionPercent =
        Number(
          q.commissionPercent ||
          q.commissionRate ||
          20
        );

      const commissionAmount =
        Math.round(
          Number(q.amount || 0) *
          commissionPercent
        ) / 100;

      // Use the same authenticated Render API helper used by Admin actions.
      // This avoids the previous 'BACKEND is not defined' browser error and
      // ensures the Firebase ID token is always attached to the request.
      const result = await renderApi('/submit-answer', {
        method: 'POST',
        body: JSON.stringify({
          questionId: questionId,
          answer: answer
        })
      });
      if (!result?.ok) {
        throw new Error(result?.error || 'Unable to submit answer.');
      }

      /* ============================================================
         CUSTOMER NOTIFICATION — ANSWER SUBMITTED
         The Render answer endpoint owns the question status, but older
         deployments may not create the customer notification. Create one
         here using the canonical customerId from the question. The
         Customer Dashboard also reconciles existing notifications from the
         question record, so this remains safe even if this write is denied.
         ============================================================ */
      try{
        const latestSnap=await withTimeout(getDoc(questionRef),15000);
        const latestQ=latestSnap.exists()?(latestSnap.data()||{}):q;
        const customerId=String(latestQ.customerId||q.customerId||'').trim();
        if(customerId){
          const astroName=String(latestQ.astrologerName||q.astrologerName||'Astrologer');
          const answerSubmittedAt=latestQ.answerSubmittedAt||latestQ.updatedAt||serverTimestamp();
          await setDoc(doc(db,'smv_notifications',customerId+'_answer_submitted_'+questionId),{
            userId:customerId,
            type:'astrologer_answer_submitted',
            title:'ஜோதிடர் பதில் சமர்ப்பிக்கப்பட்டது',
            message:'Astro '+astroName.replace(/^Astro\s+/i,'')+' has submitted an answer to your question. It is now waiting for Admin approval.',
            questionId:questionId,
            customerPaymentId:latestQ.customerPaymentId||q.customerPaymentId||'',
            astrologerId:latestQ.astrologerId||q.astrologerId||'',
            astrologerName:astroName,
            createdAt:answerSubmittedAt,
            updatedAt:serverTimestamp(),
            read:false
          },{merge:true});
        }
      }catch(customerNotificationError){
        console.warn('Customer answer-submitted notification write skipped:',customerNotificationError);
      }

      alert('பதில் வெற்றிகரமாக சமர்ப்பிக்கப்பட்டது. ஒப்புதலுக்காக காத்திருக்கிறது.');

      // Force a fresh render so the submitted answer leaves the Unanswered
      // Queue and appears immediately under பதில்கள் — பதிலளிக்கப்பட்ட கேள்விகள்.
      await loadDashboard('astrologer', true);
      requestAnimationFrame(() => setTimeout(() => {
        $('astroAnsweredBox')?.scrollIntoView({ behavior:'smooth', block:'start' });
      }, 120));

    } catch (e) {

      console.error(
        'Answer submission error:',
        e
      );

      alert(
        e.message || String(e)
      );

      b.disabled = false;
      b.textContent = 'திருத்தி மீண்டும் சமர்ப்பிக்கவும்';
    }

  };

});
   document.querySelectorAll('[id^="ans_"]').forEach(t=>{
     const id=t.id.slice(4), btn=document.querySelector(`[data-answer="${id}"]`), counter=$('count_'+id), q=qs.docs.find(x=>x.id===id)?.data()||{}, min=Number(q.answerMinWords||150);
     const updateCount=()=>{const n=t.value.trim()?t.value.trim().split(/\s+/).filter(Boolean).length:0;if(counter)counter.textContent=`${n} / ${min} words`;if(btn)btn.disabled=n<min;};
     t.addEventListener('input',updateCount);updateCount();
   });
  if($('withdrawBtn')) $('withdrawBtn').onclick = async () => {

  if(!currentUser){
    alert('Please login again.');
    return;
  }

  try {

    const questionSnap = await withTimeout(
      getDocs(
        query(
          collection(db,'smv_questions'),
          where('astrologerId','==',currentUser.uid)
        )
      ),
      15000
    );

    let totalEarnings = 0;

    questionSnap.docs.forEach(d => {

      const q = d.data();

      if(
        q.status === 'answered' &&
        q.commissionStatus === 'credited'
      ){

        totalEarnings += Number(
          q.astrologerCommissionAmount ||
          q.commissionAmount ||
          0
        );

      }

    });

    const withdrawalSnap = await withTimeout(
      getDocs(
        query(
          collection(db,'smv_withdrawals'),
          where('astrologerId','==',currentUser.uid)
        )
      ),
      15000
    );

    let reservedWithdrawals = 0;
    let totalWithdrawals = 0;
    let latestWithdrawalAt = null;
    withdrawalSnap.docs.forEach(d => {
      const w = d.data() || {};
      const st = String(w.status || 'pending').toLowerCase();
      const amount = Number(w.amount || 0);
      if(['pending','processing','paid'].includes(st)){
        reservedWithdrawals += amount;
        totalWithdrawals += amount;
        const raw = w.createdAt || w.requestedAt || w.paidAt || null;
        const ms = raw?.toMillis ? raw.toMillis() : Number(raw || 0);
        if(ms && (!latestWithdrawalAt || ms > latestWithdrawalAt)) latestWithdrawalAt = ms;
      }
    });
    const available = Math.max(0, Math.round((totalEarnings - reservedWithdrawals) * 100) / 100);
    const min = 300;
    const cooldownMs = 7 * 24 * 60 * 60 * 1000;
    const cooldownActive = !!latestWithdrawalAt && (Date.now() - latestWithdrawalAt < cooldownMs);
    const eligible = available >= min && !cooldownActive;

    openModal(`
      <h2>Withdraw Earnings</h2>

      <p>
        Total Earnings:
        <b>₹${totalEarnings.toFixed(2)}</b>
      </p>

      <p>
        Total Withdrawal:
        <b>₹${totalWithdrawals.toFixed(2)}</b>
      </p>

      <p>
        Available:
        <b class="${(available >= min && !cooldownActive) ? 'smv-modal-available-green' : 'smv-modal-available-red'}">₹${available.toFixed(2)}</b>
      </p>

      <p class="small">
        Minimum withdrawal:
        ₹${min.toFixed(2)}.
        ${cooldownActive ? `<br><b class="smv-withdraw-locked">Withdrawal is blocked for 7 days after the last withdrawal request.</b><br>Available again: ${escapeHtml(smvDateTime(new Date(latestWithdrawalAt + cooldownMs)))}` : 'Payment will be arranged by Admin within 24–48 hours.'}
      </p>

      <div id="withdrawPaymentIds" class="small" style="margin:10px 0"><b>Withdrawal Request ID:</b> Will be generated when you submit the request.</div>

      <input
        id="withdrawAmount"
        type="number"
        min="${min}"
        max="${available}"
        step="0.01"
        value="${available.toFixed(2)}"
        placeholder="Amount"
      >

      <button
        class="btn ${eligible ? 'smv-withdraw-btn is-green' : 'smv-withdraw-btn is-red'}"
        id="confirmWithdraw"
        ${eligible ? '' : 'disabled'}
      >
        REQUEST WITHDRAWAL
      </button>

      <div
        id="withdrawMsg"
        class="small"
        style="margin-top:8px"
      ></div>
    `);

    $('confirmWithdraw').onclick = async () => {

      const amount =
        Number($('withdrawAmount').value);

      const btn2 =
        $('confirmWithdraw');

      if(cooldownActive){
        alert('Withdrawal is blocked for 7 days after the last withdrawal request.');
        return;
      }
      if(available < min){
        alert(`Available withdrawal balance must be at least ₹${min}.`);
        return;
      }
      if(!Number.isFinite(amount)){
        alert('Enter a valid amount.');
        return;
      }

      if(amount < min){
        alert(
          `Minimum withdrawal is ₹${min}.`
        );
        return;
      }

      if(amount > available){
        alert(
          'Withdrawal amount cannot exceed available earnings.'
        );
        return;
      }

      btn2.disabled = true;
      btn2.textContent = 'REQUESTING...';

      try {
        const result = await withTimeout(renderApi('/astrologer/withdrawal-request', {
          method:'POST',
          body:JSON.stringify({amount:Math.round(amount * 100) / 100})
        }), 20000);

        const withdrawalId = String(result.withdrawalId || result.paymentId || '');
        if(!withdrawalId) throw new Error('Withdrawal ID was not returned by the Render backend.');

        $('withdrawPaymentIds').innerHTML = '<b>Withdrawal Request ID:</b> ' + escapeHtml(withdrawalId);

        $('withdrawMsg').innerHTML =
          '<span class="success"><b>Withdrawal request received.</b><br>Requested: '+escapeHtml(smvDateTime(new Date()))+'<br>Admin will arrange payment within 24–48 hours.</span>';

        setTimeout(async () => {
          closeModal();
          // Withdrawal changes Firestore state and starts the 7-day cooldown.
          // Force a fresh dashboard render immediately; a normal loadDashboard()
          // call can return early because the existing dashboard is already ready.
          try { await loadDashboard('astrologer', true); }
          catch (refreshError) { console.warn('Withdrawal dashboard refresh failed:', refreshError); }
        },300);

      } catch(e) {

        console.error(
          'Withdrawal request error:',
          e
        );

        $('withdrawMsg').innerHTML =
          '<span class="error">' +
          escapeHtml(
            e.message || String(e)
          ) +
          '</span>';

        btn2.disabled = false;
        btn2.textContent =
          'REQUEST WITHDRAWAL';
      }

    };

  } catch(e) {

    console.error(
      'Earnings calculation error:',
      e
    );

    alert(
      e.message || String(e)
    );

  }

};
   const change=()=>openPayoutChange();
   if($('changePayoutBtn')) $('changePayoutBtn').onclick=change;
   if($('changePayoutBtn2')) $('changePayoutBtn2').onclick=change;
  } else {
   // FAST CUSTOMER LOAD: Firestore is the primary dashboard source because the
   // customer already owns these question documents. The old flow waited for a
   // 15s Render API call and then performed one Firestore read per question.
   // That made the entire dashboard appear slow. Read the profile + all customer
   // questions in parallel and render immediately. Render reconciliation/refund
   // work is optional and runs only after the main data is available.
   const cr=await renderApi('/customer/consultations?_fresh='+Date.now()+'-'+loadId,{method:'GET'});
   if(!cr?.success||!Array.isArray(cr.questions))throw new Error(cr?.error||'Unable to load current questions.');
   if(cr.customerId && cr.customerId!==loadUid)throw new Error('The response belongs to a different login session.');
   if(!active())return;
   const consultationItems=cr.questions.slice().sort((a,b)=>Date.parse(b.createdAt||'')-Date.parse(a.createdAt||''));
   const hasPendingRefund=false;
   const paid=consultationItems.filter(q=>q.status!=='awaiting_payment').length;
   const qCount=consultationItems.length;
   if(!active()) return;
   box.innerHTML=`<div class="grid"><div class="card"><span class="badge">வாடிக்கையாளர்</span><h3>வரவேற்கிறோம், <span translate="no">${escapeHtml(data.name||currentUser.email||'வாடிக்கையாளர்')}</span></h3><p>மின்னஞ்சல் சரிபார்ப்பு: ${currentUser.emailVerified?'<span class="smv-verified-badge"><span class="smv-check">✓</span>சரிபார்க்கப்பட்டது</span>':'<b>பதிவு முடிந்த பின் சரிபார்ப்பு நிலுவையில் உள்ளது</b>'}</p><p>கைபேசி: தனிப்பட்டது</p></div><div class="card"><h3>என் கேள்விகள்</h3><p>Total: <b>${qCount}</b></p><p>Paid/processed: <b>${paid}</b></p></div></div>
   <div class="card" style="margin-top:16px"><h3 class="customer-consultations-title">என் ஆலோசனைகள்</h3>${!consultationItems.length?'<div class="empty">இதுவரை ஆலோசனைகள் இல்லை. ஜோதிடரைத் தேர்ந்தெடுத்து தனிப்பட்ட ஆலோசனையைத் தொடங்குங்கள்.</div>':consultationItems.slice(0,20).map(q=>{const qid=String(q.questionId||q.id||''); const reviewButton=q.status==='answered'&&!q.reviewed?`<button class="btn" data-review="${escapeHtml(qid)}" data-astro="${escapeHtml(q.astrologerId||'')}">மதிப்பீடு & விமர்சனம்</button>`:''; const paymentRetryButton=['awaiting_payment','payment_failed'].includes(String(q.status||''))&&qid?`<button class="btn" data-retry-payment="${escapeHtml(qid)}" type="button">கட்டணத்தை மீண்டும் முயற்சிக்கவும்</button>`:''; const statusMap={awaiting_payment:'கட்டணம் நிலுவையில் உள்ளது',payment_failed:'கட்டணம் தோல்வியடைந்தது',pending_admin_approval:'நிர்வாகி ஒப்புதலுக்காக காத்திருக்கிறது',assigned_to_astrologer:'ஜோதிடருக்கு ஒதுக்கப்பட்டது',available_to_astrologers:'ஜோதிடர்களுக்கு கிடைக்கிறது',claimed_by_astrologer:'ஜோதிடர் பதிலளிக்கிறார்',admin_approved:'பதிலுக்காக காத்திருக்கிறது',processing:'செயலாக்கத்தில் உள்ளது',answer_draft:'செயலாக்கத்தில் உள்ளது',admin_review:'செயலாக்கத்தில் உள்ளது',revision_required:'திருத்தம் அவசியம்',answered:'பதில் தயாராக உள்ளது',question_rejected:'கேள்வி நிராகரிக்கப்பட்டது',admin_rejected:'கேள்வி நிராகரிக்கப்பட்டது'}; const astroName=q.astrologerName||'Selected Astrologer'; const adminQuestionApproved=!!q.adminQuestionApprovedAt||['assigned_to_astrologer','reallocated','available_to_astrologers','claimed_by_astrologer','admin_approved','processing','answer_draft','admin_review','answered'].includes(String(q.status||'')); const statusText=q.status==='paid'&&!adminQuestionApproved?'நிர்வாகி ஒப்புதலுக்காக காத்திருக்கிறது':adminQuestionApproved&&['paid','admin_approved'].includes(String(q.status||''))?`பதிலுக்காக காத்திருக்கிறது — ${astroName}`:q.status==='processing'||q.status==='answer_draft'||q.status==='admin_review'?`செயலாக்கத்தில் உள்ளது — ${astroName} answer received and under Admin review`:q.status==='revision_required'?`திருத்தம் அவசியம் — ${astroName}`:q.status==='answered'?'பதில் தயாராக உள்ளது':(statusMap[q.status]||q.status||'செயலாக்கத்தில் உள்ளது'); const paymentReceived=!!q.customerPaymentId || !!q.paymentRecordedAt || !!q.paidAt || !!q.paymentDate || !['awaiting_payment','payment_failed'].includes(String(q.status||'')); const refundStatuses=['pending','created','initiated','processing']; const refundCompleted=['processed','completed']; const isQuestionRejected=['question_rejected','admin_rejected'].includes(String(q.status||'')); const refundAmount=Number(q.refundAmount||q.amount||q.paymentAmount||0); const refundStatus=String(q.refundStatus||'').toLowerCase(); const steps=isQuestionRejected?[['கட்டணம் பெறப்பட்டது',paymentReceived],['கேள்வி நிராகரிக்கப்பட்டது',true],['பணத்திரும்பப் பெறும் நிலை',refundCompleted.includes(refundStatus)]]:[['கட்டணம் பெறப்பட்டது',paymentReceived],['கேள்வி Approved',adminQuestionApproved],['ஜோதிடர் பதில் சமர்ப்பிக்கப்பட்டது',['processing','answer_draft','admin_review','revision_required','answered'].includes(String(q.status||''))],['நிர்வாகி ஒப்புதல்',['answered'].includes(String(q.status||''))],['பதில் தயாராக உள்ளது',['answered'].includes(String(q.status||''))]]; const timeline=`<div class="timeline">${steps.map(x=>`<div class="timeline-step ${x[1]?'done':''}"><span>${x[1]?'✓':'○'}</span>${x[0]}</div>`).join('')}</div>`; const paymentLine=q.customerPaymentId?`<div class="small smv-meta-line"><span class="smv-meta-label">வாடிக்கையாளர் கட்டண எண்:</span> <span class="smv-meta-value">${escapeHtml(q.customerPaymentId)}</span> · <span class="smv-meta-label">Payment தேதி & நேரம்:</span> <span class="smv-meta-value">${escapeHtml(smvDateTime(q.paymentRecordedAt||q.paidAt||q.paymentUpdatedAt||q.paymentDate))}</span></div>`:''; const isRejected=isQuestionRejected; const refundLine='';; const questionIdLine=qid?`<div class="small smv-meta-line"><span class="smv-meta-label">கேள்வி எண்:</span> <span class="smv-meta-value">${escapeHtml(qid)}</span></div>`:''; return `<div style="padding:14px 0;border-bottom:1px solid #eee"><b class="smv-question-text"><span translate="no">${escapeHtml(q.question||'கேள்வி')}</span></b>${questionIdLine}<div class="small smv-meta-line"><span class="smv-meta-label">ஜோதிடர்:</span> <span class="smv-meta-value">${escapeHtml(astroName)}</span> · <span class="smv-meta-label">நிலை:</span> <span class="smv-meta-value">${escapeHtml(statusText)}</span></div><div class="small smv-meta-line"><span class="smv-meta-label">தேதி & நேரம்:</span> <span class="smv-meta-value">${escapeHtml(smvDateTime(q.updatedAt||q.answerApprovedAt||q.adminQuestionApprovedAt||q.createdAt))}</span></div>${paymentLine}${refundLine}${isRejected&&refundAmount>0?`<div class="refund-summary" style="margin-top:12px;padding:12px 14px;border-radius:10px;border:1px solid #e6e6e6"><div class="smv-meta-line"><span class="smv-meta-label">கேள்வி நிலை:</span> <span class="smv-meta-value">🔴 Rejected</span></div><div class="smv-meta-line" style="margin-top:4px"><span class="smv-meta-label">Payment:</span> <span class="smv-meta-value">${paymentReceived?'✅ கட்டணம் பெறப்பட்டது':'⏳ கட்டணம் நிலுவையில் உள்ளது'}</span></div><div class="small smv-meta-line"><span class="smv-meta-label">செலுத்திய தொகை:</span> <span class="smv-meta-value">₹${refundAmount.toFixed(2)}</span></div><div class="smv-meta-line" style="margin-top:8px"><span class="smv-meta-label">Refund நிலை:</span> <span class="smv-meta-value">${refundCompleted.includes(refundStatus)?'<span class="success">🟢 பணம் திருப்பி வழங்கப்பட்டது</span>':refundStatus==='failed'?'<span class="error">🔴 பணம் திருப்பி வழங்குவதில் தோல்வி — நிர்வாகி பரிசீலனை தேவை</span>':'<span style="color:#b26a00">🟠 பணம் திருப்பி வழங்குவது நிலுவையில் உள்ளது</span>'}</span></div><div class="small smv-meta-line"><span class="smv-meta-label">பணத்திரும்பப் பெறும் தொகை:</span> <span class="smv-meta-value">₹${refundAmount.toFixed(2)}</span></div>${q.refundId?`<div class="small smv-meta-line"><span class="smv-meta-label">பணத்திரும்பப் பெறும் எண்:</span> <span class="smv-meta-value">${escapeHtml(q.refundId)}</span></div>`:''}${q.refundRrn?`<div class="small smv-meta-line"><span class="smv-meta-label">RRN:</span> <span class="smv-meta-value">${escapeHtml(q.refundRrn)}</span></div>`:''}${refundCompleted.includes(refundStatus)&&(q.refundCreatedAt||q.refundProcessedAt)?`<div class="small smv-meta-line"><span class="smv-meta-label">பணத்திரும்பப் பெற்ற தேதி:</span> <span class="smv-meta-value">${escapeHtml(smvDateTime(q.refundCreatedAt||q.refundProcessedAt))}</span></div>`:''}<div class="small smv-meta-line" style="margin-top:6px"><span class="smv-meta-label">பணத்திரும்பப் பெறும் காரணம்:</span> <span class="smv-meta-value">${escapeHtml(q.refundReason||q.adminQuestionRejectionReason||'கேள்வி rejected by Admin')}</span></div>${q.adminQuestionRejectedAt?`<div class="small smv-meta-line"><span class="smv-meta-label">நிராகரிக்கப்பட்ட தேதி:</span> <span class="smv-meta-value">${escapeHtml(smvDateTime(q.adminQuestionRejectedAt))}</span></div>`:''}${refundCompleted.includes(refundStatus)?`<div class="small" style="margin-top:6px">பணம் திருப்பி வழங்கும் செயல்முறை வெற்றிகரமாக முடிந்தது.<br>தொகை உங்கள் வங்கி கணக்கு அல்லது அட்டையில் பிரதிபலிக்க 5–7 வேலை நாட்கள் ஆகலாம். வங்கி பரிவர்த்தனையை கண்காணிக்க RRN-ஐ பயன்படுத்தலாம்.</div>`:''}</div>`:''}${timeline}${q.answer&&q.status==='answered'?`<div class="card" style="margin-top:10px"><b>${q.answerAuthorType==='admin'||q.adminAnswered?'நிர்வாகியின் பதில்':'ஜோதிடர் பதில்'}</b><p style="white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word"><span translate="no">${escapeHtml(q.answer)}</span></p>${q.answerAuthorType==='admin'||q.adminAnswered?'<p class="small success"><b>Answered directly by SMV ASTRO Admin.</b></p>':''}</div>`:''}${paymentRetryButton?`<div style="margin-top:10px"><div class="small pending-note">Payment was not completed. This question is still saved. You can retry the payment without creating a new question.</div>${paymentRetryButton}</div>`:''}${reviewButton}</div>`}).join('')}</div>`;
   document.querySelectorAll('[data-review]').forEach(b=>b.onclick=()=>openReview(b.dataset.review,b.dataset.astro));
   document.querySelectorAll('[data-retry-payment]').forEach(b=>b.onclick=()=>window.__smvRetryCustomerPayment?.(b.dataset.retryPayment,b)); dashboardShellUid=loadUid; if(window.__smvRefundRefreshTimer){clearTimeout(window.__smvRefundRefreshTimer);window.__smvRefundRefreshTimer=null;} if(hasPendingRefund){window.__smvRefundRefreshTimer=setTimeout(()=>{if(currentUser&&document.getElementById('dashboard')&&!document.getElementById('dashboard').classList.contains('hidden'))loadDashboard().catch(()=>{});},20000);}
  }
  if(!active()) return;
  // Mark the dashboard ready before loading optional notifications. A slow
  // notifications query must never keep the main dashboard in a loading state.
  show('dashboard');
  dashboardReadyUid=loadUid; dashboardReadyAt=Date.now();
  dashboardReadyRole=role; smvWatchQuestions(role);
  touchSession();
  armIdleTimer();
  const note=document.createElement('div'); note.className='card'; note.style.marginTop='16px'; note.innerHTML='<h3>அறிவிப்புகள்</h3><div id="userNotifications"><div class="small">Loading...</div></div>'; box.appendChild(note);
  // Notifications are supplementary. A Firestore permission/timeout issue in
  // this optional section must never turn a successfully loaded dashboard into
  // a false "Unable to load dashboard" state.
  void renderNotifications('userNotifications').catch(notificationErr=>{
    console.warn('Dashboard notifications skipped:',notificationErr);
    const nb=$('userNotifications');
    if(nb) nb.innerHTML='<div class="small">Notifications are temporarily unavailable.</div>';
  });
  if(!active()) return;
 }catch(e){
   if(!active()) return;
   console.error('Dashboard load failed:',e);
   if(dashboardReadyUid===loadUid){ dashboardReadyUid=null; dashboardReadyRole=null; }
   box.innerHTML='<div class="card error"><b>Dashboard could not be loaded.</b><p class="small">Your login session is active, but some dashboard data could not be read. The basic dashboard is being kept available.</p><button class="btn gray" id="dashboardRetry">RETRY</button></div>';
   $('dashboardRetry')?.addEventListener('click',()=>loadDashboard(expectedRole));
 }
 })();
 const ownedRequest=dashboardLoadPromise;
 try{return await ownedRequest;}finally{if(dashboardLoadPromise===ownedRequest){dashboardLoadPromise=null;dashboardLoadUid=null;}}
}
function openPayoutChange(){
 openModal(`<h2>Change Payment Method</h2><p class="small">For security, your previous bank/UPI details are not displayed. Enter the new details. The new method will remain pending until Admin approval.</p>
 <input id="pBank" placeholder="Bank Name" maxlength="120"><input id="pAccountName" placeholder="Account Holder Name" maxlength="120"><input id="pAccount" inputmode="numeric" placeholder="Account Number" maxlength="40"><input id="pIfsc" placeholder="IFSC" maxlength="20"><input id="pUpi" placeholder="UPI ID (optional)" maxlength="120"><button class="btn" id="savePayout">Submit for Admin Review</button><div id="payoutMsg" class="small"></div>`);
 $('savePayout').onclick=async()=>{
   const btn=$('savePayout'),msg=$('payoutMsg');
   try{
     if(!currentUser) throw new Error('Please login again.');
     const payload={bankName:$('pBank').value.trim(),accountName:$('pAccountName').value.trim(),accountNumber:$('pAccount').value.trim(),ifsc:$('pIfsc').value.trim().toUpperCase(),upi:$('pUpi').value.trim()};
     if(!payload.bankName||!payload.accountName||!payload.accountNumber||!payload.ifsc) throw new Error('Please complete all required payment details.');
     if(payload.accountNumber.length<6) throw new Error('Enter a valid account number.');
     if(payload.ifsc.length<4) throw new Error('Enter a valid IFSC code.');
     btn.disabled=true;btn.textContent='SUBMITTING...';
     const r=await withTimeout(renderApi('/astrologer/change-payout',{method:'POST',body:JSON.stringify(payload)}),20000);
     if(!r?.success) throw new Error(r?.error||'Unable to submit payment method change.');
     msg.innerHTML='<span class="success"><b>Payment method submitted successfully.</b><br>நிர்வாகி ஒப்புதலுக்காக காத்திருக்கிறது.</span>';
     setTimeout(()=>{closeModal();loadDashboard();},900);
   }catch(e){console.error('Payment method change error:',e);msg.innerHTML='<span class="error">'+escapeHtml(e?.message||String(e))+'</span>';btn.disabled=false;btn.textContent='Submit for Admin Review';}
 };
}
function openReview(questionId, astroId) {
  openModal(`<h2>Rate your consultation</h2>
    <select id="reviewStars"><option value="5">★★★★★ — 5</option><option value="4">★★★★☆ — 4</option><option value="3">★★★☆☆ — 3</option><option value="2">★★☆☆☆ — 2</option><option value="1">★☆☆☆☆ — 1</option></select>
    <textarea id="reviewText" placeholder="Write your review"></textarea>
    <button class="btn" id="submitReview">Submit Review</button><div id="reviewMsg" class="small"></div>`);
  $('submitReview').onclick = async () => {
    const btn=$('submitReview'), msg=$('reviewMsg');
    try {
      if(!currentUser) throw new Error('Please login again.');
      if(!questionId||!astroId) throw new Error('ஆலோசனை information is missing. Please refresh and try again.');
      const rating=Number($('reviewStars').value), review=$('reviewText').value.trim();
      if(!Number.isInteger(rating)||rating<1||rating>5) throw new Error('Please select a rating from 1 to 5.');
      if(!review) throw new Error('Please write your review.');
      btn.disabled=true; btn.textContent='SUBMITTING...';
      const questionSnap=await withTimeout(getDoc(doc(db,'smv_questions',questionId)),15000);
      if(!questionSnap.exists()) throw new Error('ஆலோசனை not found.');
      const q=questionSnap.data()||{};
      if(q.customerId!==currentUser.uid) throw new Error('You are not allowed to review this consultation.');
      if(q.status!=='answered') throw new Error('You can review only after the answer has been approved.');
      if(q.astrologerId!==astroId) throw new Error('Astrologer information does not match.');
      const reviewId=`${questionId}_${currentUser.uid}`;
      await withTimeout(setDoc(doc(db,'smv_reviews',reviewId),{questionId,customerId:currentUser.uid,customerName:q.customerName||q.birthName||'Customer',astrologerId:astroId,astrologerName:q.astrologerName||'Astrologer',rating,review,verified:true,approved:false,status:'pending',createdAt:serverTimestamp()}),15000);
      try { await withTimeout(updateDoc(doc(db,'smv_questions',questionId),{reviewed:true,reviewSubmittedAt:serverTimestamp()}),15000); }
      catch(markError){ console.warn('Review saved but review flag could not be updated:',markError); }
      msg.innerHTML='<span class="success"><b>Thank you!</b> Your review was submitted and is waiting for Admin approval.</span>';
      setTimeout(async ()=>{
        closeModal();
        // The review flag is written to the question. Force an immediate
        // customer-dashboard re-render so the மதிப்பீடு & விமர்சனம் button disappears
        // without requiring a browser refresh.
        try { await loadDashboard('customer', true); }
        catch (refreshError) { console.warn('Review dashboard refresh failed:', refreshError); }
      },300);
    } catch(e) {
      console.error('Review submission error:',e);
      const raw=String(e?.message||e);
      const friendly=/permission|insufficient permissions/i.test(raw)?'Review permission was denied by Firebase. Please publish the latest firestore.rules to the same smv-astro Firebase project.':raw;
      msg.innerHTML='<span class="error">'+escapeHtml(friendly)+'</span>'; btn.disabled=false; btn.textContent='Submit Review';
    }
  };
}

// ---------- SMV ASTRO Blog (isolated feature) ----------
// Cloudinary stores Blog text (JSON), cover images, PDFs and videos. Firestore keeps lightweight metadata/index fields.
// Existing Horoscope, Login, Ask Now, கேள்வி and Payment logic is untouched.
const SMV_CONTENT_COLLECTION="smv_content";
const SMV_CLOUDINARY_CLOUD_NAME="squ6wjl1";
const SMV_CLOUDINARY_UPLOAD_PRESET="smvastro-tamil";
const SMV_CLOUDINARY_UPLOAD_URL=`https://api.cloudinary.com/v1_1/${SMV_CLOUDINARY_CLOUD_NAME}/auto/upload`;
const SMV_MAX_BLOG_IMAGE=10*1024*1024;
const SMV_MAX_PDF=25*1024*1024;
const SMV_MAX_VIDEO=100*1024*1024;
const SMV_MAX_MUSIC=50*1024*1024;
function smvContentType(file){
  if(!file) return "";
  const name=String(file.name||"").toLowerCase();
  if(file.type==="application/pdf" || name.endsWith(".pdf")) return "pdf";
  if(file.type.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp|bmp|avif)$/i.test(name)) return "image";
  if(file.type.startsWith("video/") || /\.(mp4|webm|mov|m4v|avi|mkv)$/i.test(name)) return "video";
  if(file.type.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(name)) return "music";
  return "";
}
function smvFileLimit(type){return type==="video"?SMV_MAX_VIDEO:type==="music"?SMV_MAX_MUSIC:type==="pdf"?SMV_MAX_PDF:SMV_MAX_BLOG_IMAGE;}
async function smvUploadFile(file,type,id){
  const kind=smvContentType(file);
  if(kind!==type && !(type==="music" && !kind))
    throw new Error(`Please select a valid ${type.toUpperCase()} file.`);
  if(file.size>smvFileLimit(type)) throw new Error(`File is too large. Maximum size: ${type==="video"?"100 MB":type==="music"?"50 MB":type==="pdf"?"25 MB":"10 MB"}.`);
  if(!SMV_CLOUDINARY_CLOUD_NAME || !SMV_CLOUDINARY_UPLOAD_PRESET) throw new Error("Cloudinary upload settings are missing.");
  const form=new FormData();
  form.append("file",file);
  form.append("upload_preset",SMV_CLOUDINARY_UPLOAD_PRESET);
  form.append("folder",type==="pdf"?"smv-astro/pdfs":type==="video"?"smv-astro/videos":type==="music"?"smv-astro/music":"smv-astro/images");
  form.append("context",`smv_id=${id}|original_name=${file.name}`);
  // Use Cloudinary AUTO so one unsigned preset can correctly detect
  // image, PDF/raw, video and audio/music without resource-type mismatch.
  const endpoint=SMV_CLOUDINARY_UPLOAD_URL;
  const response=await fetch(endpoint,{method:"POST",body:form});
  const result=await response.json().catch(()=>({}));
  if(!response.ok || !result.secure_url) throw new Error(result.error?.message || "Cloudinary upload failed. Check the upload preset name and make sure it is Unsigned.");
  return {url:result.secure_url,path:result.public_id,publicId:result.public_id,size:file.size,mimeType:file.type,name:file.name,resourceType:result.resource_type||type};
}function smvFormatBytes(n){
  n=Number(n)||0;if(n<1024)return `${n} B`;if(n<1024*1024)return `${(n/1024).toFixed(1)} KB`;return `${(n/1024/1024).toFixed(1)} MB`;
}
async function smvGetவெளியிடப்பட்டதுContent(){
  const snap=await getDocs(query(collection(db,SMV_CONTENT_COLLECTION),where("published","==",true),where("language","==","ta")));
  return snap.docs.map(d=>({id:d.id,...(d.data()||{})})).sort((a,b)=>{
    const av=a.publishedAt?.seconds||a.createdAt?.seconds||0,bv=b.publishedAt?.seconds||b.createdAt?.seconds||0;return bv-av;
  });
}
async function smvFetchBlogBody(bodyUrl){
  if(!bodyUrl) return "";
  try{const r=await fetch(bodyUrl,{cache:"no-store"});if(!r.ok)throw new Error("வலைப்பதிவு உள்ளடக்கம் கிடைக்கவில்லை");const j=await r.json();return typeof j.body==="string"?j.body:"";}
  catch(e){console.warn("Unable to load blog body:",e);return "The blog content is temporarily unavailable.";}
}
async function smvRenderPublicContent(items){
  const blogs=items.filter(x=>x.kind==="blog"),media=items.filter(x=>x.kind==="media");
  const blogBox=$("publicBlogs"),mediaBox=$("publicMedia");
  if(blogBox){
    if(!blogs.length) blogBox.innerHTML='<div class="empty">வெளியிடப்பட்ட வலைப்பதிவுகள் எதுவும் இல்லை.</div>';
    else {const cards=await Promise.all(blogs.map(async x=>{const body=await smvFetchBlogBody(x.bodyUrl);return `<article class="card blog-card"><h3>${escapeHtml(x.title||"Untitled")}</h3>${x.coverUrl?`<img class="content-thumb" src="${escapeHtml(x.coverUrl)}" alt="${escapeHtml(x.title||"Blog")}">`:""}${x.summary?`<p class="small"><b>${escapeHtml(x.summary)}</b></p>`:""}<div class="blog-content">${escapeHtml(body)}</div><div class="small" style="margin-top:auto;padding-top:12px">வெளியிடப்பட்டது ${escapeHtml(smvDateTime(x.publishedAt||x.createdAt))}</div></article>`;}));blogBox.innerHTML=cards.join("");}
  }
  if(mediaBox){
    const mediaTypeRank={video:0,music:1,pdf:2,image:3};
    const orderedMedia=[...media].sort((a,b)=>{
      const ar=mediaTypeRank[a.mediaType]??9, br=mediaTypeRank[b.mediaType]??9;
      if(ar!==br) return ar-br;
      const av=a.publishedAt?.seconds||a.createdAt?.seconds||0, bv=b.publishedAt?.seconds||b.createdAt?.seconds||0;
      return bv-av;
    });
    mediaBox.innerHTML=orderedMedia.length?(()=>{
  const groups=[
    ['video','வீடியோ'],
    ['music','இசை'],
    ['pdf','PDF'],
    ['image','படங்கள்']
  ];
  const renderCard=x=>{
    const title=escapeHtml(x.title||"Content"),desc=x.description?`<p class="small">${escapeHtml(x.description)}</p>`:"";
    if(x.mediaType==="video") return `<article class="card media-card media-video"><h3>${title}</h3><video controls preload="metadata" src="${escapeHtml(x.url)}"></video>${desc}</article>`;
    if(x.mediaType==="music") return `<article class="card media-card media-music"><h3>🎵 ${title}</h3><audio controls preload="metadata" src="${escapeHtml(x.url)}"></audio><p class="small">Music · ${escapeHtml(smvFormatBytes(x.size))}</p>${desc}</article>`;
    if(x.mediaType==="pdf") return `<article class="card media-card media-pdf"><h3>${title}</h3><p class="small">PDF · ${escapeHtml(smvFormatBytes(x.size))}</p>${desc}<a class="btn" href="${escapeHtml(x.url)}" target="_blank" rel="noopener" download>PDF பதிவிறக்கம்</a></article>`;
    return `<article class="card media-card media-image"><h3>${title}</h3><img src="${escapeHtml(x.url)}" alt="${title}" loading="lazy">${desc}</article>`;
  };
  return groups.map(([type,label])=>{
    const items=orderedMedia.filter(x=>x.mediaType===type);
    if(!items.length)return '';
    return `<section class="smv-media-type-section smv-media-type-${type}"><h3 class="smv-media-type-title">${label}</h3><div class="smv-media-type-grid">${items.map(renderCard).join('')}</div></section>`;
  }).join('');
})():'<div class="empty">வெளியிடப்பட்ட ஊடகங்கள் எதுவும் இல்லை.</div>';
  }
}
async function loadPublicContent(){try{await smvRenderPublicContent(await smvGetவெளியிடப்பட்டதுContent());}catch(e){console.warn("Public content unavailable:",e);if($("publicBlogs"))$("publicBlogs").innerHTML='<div class="empty">உள்ளடக்கம் தற்காலிகமாக கிடைக்கவில்லை.</div>';if($("publicMedia"))$("publicMedia").innerHTML='<div class="empty">ஊடகம் தற்காலிகமாக கிடைக்கவில்லை.</div>';}}
function smvClearBlogForm(){
  ["blogEditId","blogTitle","blogSummary","blogBody"].forEach(id=>{if($(id))$(id).value="";});
  if($("blogCoverFile"))$("blogCoverFile").value="";if($("saveBlogBtn"))$("saveBlogBtn").textContent="PUBLISH BLOG";
}
function smvClearMediaForm(){
  ["mediaEditId","mediaTitle","mediaDescription"].forEach(id=>{if($(id))$(id).value="";});
  ["mediaImageFile","mediaPdfFile","mediaVideoFile","mediaMusicFile"].forEach(id=>{if($(id))$(id).value="";});
  if($("mediaSelectedFile"))$("mediaSelectedFile").textContent="No file selected.";
  if($("uploadMediaBtn"))$("uploadMediaBtn").textContent="பதிவேற்றி வெளியிடவும்";
}
async function loadAdminContent(){
  const box=$("adminBlogsMedia");if(!box)return;
  try{
    const snap=await getDocs(query(collection(db,SMV_CONTENT_COLLECTION),where("language","==","ta")));
    const items=snap.docs.map(d=>({id:d.id,...(d.data()||{})})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
    box.innerHTML=items.length?items.map(x=>{
      const status=x.published?'<span class="success">PUBLISHED</span>':'<span class="small">DRAFT</span>';
      return `<div class="admin-content-row"><b>${escapeHtml(x.title||"Untitled")}</b> · ${escapeHtml(x.kind||"")} ${x.mediaType?`· ${escapeHtml(x.mediaType)}`:""} · ${status}<div class="small">${escapeHtml(x.summary||x.description||"")}</div><div class="admin-blog-actions">${x.kind==="blog"?`<button class="btn gray" data-content-edit="${x.id}">EDIT</button>`:""}<button class="btn gray" data-content-toggle="${x.id}">${x.published?"UNPUBLISH":"PUBLISH"}</button><button class="btn danger" data-content-delete="${x.id}">DELETE</button></div></div>`;
    }).join(""):'<div class="empty">No blogs or uploaded content yet.</div>';
    box.querySelectorAll("[data-content-edit]").forEach(b=>b.onclick=async()=>{
      const x=items.find(i=>i.id===b.dataset.contentEdit);if(!x)return;$("blogEditId").value=x.id;$("blogTitle").value=x.title||"";$("blogSummary").value=x.summary||"";$("blogBody").value=await smvFetchBlogBody(x.bodyUrl);if($("blogCoverFile"))$("blogCoverFile").value="";$("saveBlogBtn").textContent="SAVE & REPUBLISH";$("adminContentManager")?.scrollIntoView({behavior:"smooth",block:"start"});
    });
    box.querySelectorAll("[data-content-toggle]").forEach(b=>b.onclick=async()=>{
      try{const item=items.find(x=>x.id===b.dataset.contentToggle);await updateDoc(doc(db,SMV_CONTENT_COLLECTION,b.dataset.contentToggle),{published:!item?.published,publishedAt:serverTimestamp(),updatedAt:serverTimestamp(),updatedBy:currentUser.uid});await loadAdminContent();await loadPublicContent();}catch(e){smvNotice("Unable to update",e.message||String(e),"!");}
    });
    box.querySelectorAll("[data-content-delete]").forEach(b=>b.onclick=async()=>{
      if(!(await smvConfirm("Delete content","This will remove the content record from SMV ASTRO. The Cloudinary files remain stored for safety; automatic Cloudinary deletion requires a secure server-side API key.","DELETE","CANCEL",true)))return;
      const x=items.find(i=>i.id===b.dataset.contentDelete);try{await deleteDoc(doc(db,SMV_CONTENT_COLLECTION,b.dataset.contentDelete));await loadAdminContent();await loadPublicContent();}catch(e){smvNotice("Unable to delete",e.message||String(e),"!");}
    });
  }catch(e){box.innerHTML='<div class="empty error">Unable to load content: '+escapeHtml(e.message||String(e))+'</div>';}
}
async function smvUploadBlogText(body,id){
  const payload=JSON.stringify({version:1,id,body,updatedAt:new Date().toISOString()});
  const file=new Blob([payload],{type:"application/json"});
  const form=new FormData();form.append("file",file,`blog-${id}.json`);form.append("upload_preset",SMV_CLOUDINARY_UPLOAD_PRESET);form.append("folder","smv-astro/blogs");form.append("public_id",`blog-${id}-${Date.now()}`);form.append("context",`smv_id=${id}|type=blog_text`);
  const response=await fetch(SMV_CLOUDINARY_UPLOAD_URL,{method:"POST",body:form});const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.secure_url)throw new Error(result.error?.message||"Cloudinary blog text upload failed. Check the unsigned upload preset and raw-file delivery settings.");
  return {url:result.secure_url,publicId:result.public_id,size:file.size};
}
async function saveBlog(){
  const sourceTitle=$("blogTitle")?.value.trim(),sourceSummary=$("blogSummary")?.value.trim(),sourceBody=$("blogBody")?.value.trim(),editId=$("blogEditId")?.value.trim();
  if(!sourceTitle||!sourceBody){smvNotice("வலைப்பதிவு","தலைப்பையும் உள்ளடக்கத்தையும் உள்ளிடவும்.","!");return;}
  const b=$("saveBlogBtn");b.disabled=true;b.textContent="வெளியிடப்படுகிறது...";
  try{
    const submitted={title:sourceTitle,summary:sourceSummary,body:sourceBody};
    let id=editId,old=null;if(editId){const oldSnap=await getDoc(doc(db,SMV_CONTENT_COLLECTION,editId));if(!oldSnap.exists())throw new Error("வலைப்பதிவு கிடைக்கவில்லை.");old=oldSnap.data()||{};}else id=doc(collection(db,SMV_CONTENT_COLLECTION)).id;
    let coverUrl=old?.coverUrl||"",coverPath=old?.coverPath||"";const file=$("blogCoverFile")?.files?.[0];if(file){const up=await smvUploadFile(file,"image",id);coverUrl=up.url;coverPath=up.path;}
    const textUp=await smvUploadBlogText(submitted.body,id);
    const data={kind:"blog",title:submitted.title,summary:submitted.summary,sourceTitle,sourceSummary,sourceBody,language:"ta",bodyUrl:textUp.url,bodyPublicId:textUp.publicId,bodySize:textUp.size,coverUrl,coverPath,published:true,updatedAt:serverTimestamp(),updatedBy:currentUser.uid};
    if(editId)await updateDoc(doc(db,SMV_CONTENT_COLLECTION,editId),data);else await setDoc(doc(db,SMV_CONTENT_COLLECTION,id),{...data,createdAt:serverTimestamp(),publishedAt:serverTimestamp(),authorUid:currentUser.uid});
    smvClearBlogForm();await loadAdminContent();await loadPublicContent();$("blogManagerMsg").innerHTML='<span class="success">வலைப்பதிவு வெளியிடப்பட்டது.</span>';
  }catch(e){$("blogManagerMsg").innerHTML='<span class="error">'+escapeHtml(e.message||String(e))+'</span>';}finally{b.disabled=false;b.textContent="வலைப்பதிவை வெளியிடவும்";}
}
async function uploadMedia(){
  const title=$("mediaTitle")?.value.trim(),desc=$("mediaDescription")?.value.trim();
  const musicFile=$("mediaMusicFile")?.files?.[0];
  let file=$("mediaImageFile")?.files?.[0] || $("mediaPdfFile")?.files?.[0] || $("mediaVideoFile")?.files?.[0] || musicFile;
  if(!title||!file){smvNotice("Upload Content","Enter a title and select a PDF, image, video or music file.","!");return;}

  // When the user selected the Music button, treat that selected file as music
  // even if Android reports an empty MIME type or hides the extension.
  let type=musicFile ? "music" : smvContentType(file);
  if(!type){smvNotice("Upload Content","Only PDF, image, video and music files are supported.","!");return;}

  // Give Cloudinary a reliable audio filename/MIME when Android supplied neither.
  if(musicFile && !file.type){
    file=new File([file], file.name && /\.[a-z0-9]{2,5}$/i.test(file.name) ? file.name : `${file.name || "music"}.mp3`, {type:"audio/mpeg"});
  }

  const b=$("uploadMediaBtn");b.disabled=true;b.textContent="பதிவேற்றப்படுகிறது...";
  try{const id=doc(collection(db,SMV_CONTENT_COLLECTION)).id,up=await smvUploadFile(file,type,id);await setDoc(doc(db,SMV_CONTENT_COLLECTION,id),{kind:"media",title,description:desc,language:"ta",mediaType:type,url:up.url,storagePath:up.path,cloudinaryPublicId:up.publicId,size:up.size,mimeType:up.mimeType,fileName:up.name,published:true,createdAt:serverTimestamp(),publishedAt:serverTimestamp(),authorUid:currentUser.uid});smvClearMediaForm();await loadAdminContent();await loadPublicContent();$("mediaManagerMsg").innerHTML='<span class="success">Content uploaded and published successfully.</span>';}catch(e){$("mediaManagerMsg").innerHTML='<span class="error">'+escapeHtml(e.message||String(e))+'</span>';}finally{b.disabled=false;b.textContent="பதிவேற்றி வெளியிடவும்";}
}
function initContentManager(){
  $("saveBlogBtn")?.addEventListener("click",saveBlog);
  $("clearBlogBtn")?.addEventListener("click",smvClearBlogForm);
  $("uploadMediaBtn")?.addEventListener("click",uploadMedia);
  $("clearMediaBtn")?.addEventListener("click",smvClearMediaForm);
  const picker=(id,type)=>{
    $(id)?.addEventListener("click",()=>$(type)?.click());
  };
  picker("chooseMediaImage","mediaImageFile");
  picker("chooseMediaPdf","mediaPdfFile");
  picker("chooseMediaVideo","mediaVideoFile");
  picker("chooseMediaMusic","mediaMusicFile");
  ["mediaImageFile","mediaPdfFile","mediaVideoFile","mediaMusicFile"].forEach(id=>$(id)?.addEventListener("change",()=>{
    const f=$(id)?.files?.[0];
    if(f && $("mediaSelectedFile")) $("mediaSelectedFile").textContent=`Selected: ${f.name} (${smvFormatBytes(f.size)})`;
  }));
}
initContentManager();
loadPublicContent();

let __smvAdminHydrationPromise=null;
let __smvAdminHydrationUid=null;

/* FINAL ADMIN SPEED PASS:
   Show the Admin shell immediately and hydrate its data only once in the
   background. This prevents the old two-stage "open -> loading -> render"
   feeling and matches the Customer/Astrologer dashboard UX. */
function renderAdminShellFast(){
  hideHomeSurface();
  hidePrimarySections('admin');
  hide('dashboard');
  hide('dashboardContent');
  hide('dashLink');
  show('admin');
  show('adminLink');
  smvShowRoleNav();
  smvEnterInternalView('admin',true);
  try{history.replaceState({smvView:'admin'},'', '#admin');}catch(_e){}
}

function loadAdminPanel(){
  renderAdminShellFast();
  const uid=currentUser?.uid||null;
  if(!uid)return Promise.resolve();
  if(__smvAdminHydrationPromise && __smvAdminHydrationUid===uid) return __smvAdminHydrationPromise;
  __smvAdminHydrationUid=uid;
  __smvAdminHydrationPromise=__smvHydrateAdminPanel().catch(err=>{
    console.error('Admin dashboard hydration failed:',err);
    const msg=$('adminDataLoadMsg');
    if(msg) msg.innerHTML='<div class="empty error">Unable to load Admin data: '+escapeHtml(err?.message||String(err))+'</div>';
  }).finally(()=>{
    const p=__smvAdminHydrationPromise;
    setTimeout(()=>{if(__smvAdminHydrationPromise===p){__smvAdminHydrationPromise=null;__smvAdminHydrationUid=null;}},0);
  });
  return __smvAdminHydrationPromise;
}

async function __smvHydrateAdminPanel(){
 if(!currentUser || !(await isCurrentAdmin())){hide('admin');hide('adminLink');return;}
  loadAdminContent();
  // Admin shell is already visible; appointment-only refresh stays background.
  setTimeout(()=>window.__smvRefreshAdminSections?.(),0);
 try{
  const adminLoadUid=currentUser.uid;
  const adminData=await __smvGetAdminData();
  if(!adminData?.success) throw new Error(adminData?.error||'Admin data could not be loaded.');
  const toDocs=(arr)=>({docs:(arr||[]).map(x=>({id:x.id,data:()=>x})),size:(arr||[]).length,empty:!(arr||[]).length});
  const users=toDocs(adminData.users), astros=toDocs(adminData.astrologers), questions=toDocs(adminData.questions), payments=toDocs(adminData.payments);
  if(!currentUser || currentUser.uid!==adminLoadUid || currentUser.uid!==auth?.currentUser?.uid) return;
  renderAdminWorkflows({data:adminData,api:renderApi,refresh:smvRefreshWorkflowCards,lang:"ta",escape:escapeHtml,date:smvDateTime});
  smvWatchAdminQuestions();
  const adminReadErrors=adminData.errors||{};
  const readErrorText=Object.entries(adminReadErrors).filter(([,v])=>v).map(([k,v])=>k+': '+v).join(' | ');
  $('adminDataLoadMsg') && ($('adminDataLoadMsg').innerHTML=readErrorText?'<div class="empty error">Some Admin data could not be loaded: '+escapeHtml(readErrorText)+'</div>':'');
  const customers=(adminData.customers||[]).length, pendingDocs=astros.docs.filter(d=>d.data().status==='pending').slice().sort((a,b)=>smvAdminSortTime(b)-smvAdminSortTime(a));
  const userMap=new Map(users.docs.map(d=>[d.id,d.data()]));
  $('adminSummary').innerHTML=`<div class="stat">Customers <b>${customers}</b></div><div class="stat">Astrologers <b>${astros.size}</b></div><div class="stat">Pending <b>${pendingDocs.length}</b></div><div class="stat">Questions <b>${questions.size}</b></div>`;
  let settings={astroPercent:20,adminPercent:80};
  let questionSettings={price:5};
  let answerSettings={minimumWords:150};
  const adminSettingsPromise=Promise.all([
    getDoc(doc(db,'smv_settings','commission')).catch(()=>null),
    getDoc(doc(db,'smv_settings','question')).catch(()=>null),
    getDoc(doc(db,'smv_settings','answer')).catch(()=>null)
  ]).then(([commissionSnap,questionSnap,answerSnap])=>{
    if(commissionSnap?.exists()) settings=commissionSnap.data();
    if(questionSnap?.exists()) questionSettings=questionSnap.data();
    if(answerSnap?.exists()) answerSettings=answerSnap.data();
    if($('questionPrice')) $('questionPrice').value=Number(questionSettings.price||5);
    if($('astroCommission')) $('astroCommission').value=settings.astroPercent??20;
    if($('adminCommission')) $('adminCommission').value=settings.adminPercent??80;
    if($('minimumAnswerWords')) $('minimumAnswerWords').value=Number(answerSettings.minimumWords||150);
  }).catch(e=>console.warn('Admin settings background load skipped:',e));
  $('questionPrice').value=Number(questionSettings.price||5);
  $('saveQuestionPrice').onclick=async()=>{const price=Math.round(Number($('questionPrice').value)*100)/100;if(!Number.isFinite(price)||price<1){$('questionPriceMsg').innerHTML='<span class="error">Enter a valid price of at least ₹1.</span>';return;}const b=$('saveQuestionPrice');b.disabled=true;b.textContent='SAVING...';try{await setDoc(doc(db,'smv_settings','question'),{price,updatedAt:serverTimestamp(),updatedBy:currentUser.uid});questionServicePrice=price;if($('askRate'))$('askRate').innerHTML=`<b>₹${price.toFixed(2)} per கேள்வி</b>`;if($('publicQuestionPrice'))$('publicQuestionPrice').textContent=`₹${price.toFixed(2)}`;$('questionPriceMsg').innerHTML='<span class="success">Current public question price saved: ₹'+price.toFixed(2)+'</span>';}catch(e){$('questionPriceMsg').innerHTML='<span class="error">Unable to save price: '+escapeHtml(e.message||String(e))+'</span>';}finally{b.disabled=false;b.textContent='SAVE PRICE';}};
  $('astroCommission').value=settings.astroPercent??20;$('adminCommission').value=settings.adminPercent??80;
  $('saveCommission').onclick=async()=>{const a=Number($('astroCommission').value),ad=Number($('adminCommission').value);if(a<0||ad<0||Math.abs(a+ad-100)>0.001){$('commissionMsg').innerHTML='<span class="error">Astrologer % + Admin % must equal 100%.</span>';return;}await setDoc(doc(db,'smv_settings','commission'),{astroPercent:a,adminPercent:ad,updatedAt:serverTimestamp(),updatedBy:currentUser.uid});$('commissionMsg').innerHTML='<span class="success">Commission settings saved.</span>';};
  $('minimumAnswerWords').value=Number(answerSettings.minimumWords||150);
  $('saveAnswerWords').onclick=async()=>{const n=Math.floor(Number($('minimumAnswerWords').value));if(!Number.isFinite(n)||n<1||n>10000){$('answerWordsMsg').innerHTML='<span class="error">1 முதல் 10000 சொற்களுக்குள் குறைந்தபட்ச எண்ணிக்கையை உள்ளிடவும்.</span>';return;}await setDoc(doc(db,'smv_settings','answer'),{minimumWords:n,updatedAt:serverTimestamp(),updatedBy:currentUser.uid});$('answerWordsMsg').innerHTML='<span class="success">குறைந்தபட்ச பதில் நீளம் சேமிக்கப்பட்டது: '+n+' சொற்கள். இது புதிய கட்டண கேள்விகளுக்கு பொருந்தும்.</span>';};
  $('testRazorpayBtn').onclick=async()=>{const b=$('testRazorpayBtn');b.disabled=true;b.textContent='TESTING...';try{const r=await withTimeout(renderApi('/test-razorpay',{method:'GET'}),60000);$('razorpayTestMsg').innerHTML='<span class="success"><b>Razorpay connection OK.</b> '+escapeHtml(r?.message||'Render payment server and Razorpay API are working.')+'</span>';}catch(e){$('razorpayTestMsg').innerHTML='<span class="error"><b>Razorpay test failed:</b> '+escapeHtml(e.message||String(e))+'</span>';}b.disabled=false;b.textContent='TEST RAZORPAY CONNECTION';};

  const box=$('pendingAstros');
  box.innerHTML=pendingDocs.length?pendingDocs.map(d=>{const a=d.data();return `<div class="card" style="margin:10px 0">${a.photoData?`<img src="${a.photoData}" style="width:100px;height:100px;border-radius:50%;object-fit:cover">`:''}<h3><span translate="no">${escapeHtml(a.name||'Astrologer')}</span></h3><p><b>Email:</b> ${escapeHtml(userMap.get(d.id)?.email||'')}</p><p><b>Mobile:</b> ${escapeHtml(userMap.get(d.id)?.mobile||userMap.get(d.id)?.phone||'')}</p><p><b>Expertise:</b> ${escapeHtml(a.expertise||a.specialization||'')}</p><p><b>Experience:</b> ${escapeHtml(a.experience||0)} years</p><p><b>Bio:</b> <span translate="no">${escapeHtml(a.bio||a.about||'')}</span></p><div id="payout_${d.id}" class="small">Loading private payout details...</div><div class="action-row"><input id="price_${d.id}" type="number" min="1" placeholder="ஆலோசனை amount (Admin only)"><button class="btn" data-approve="${d.id}">APPROVE</button><button class="btn gray" data-reject="${d.id}">REJECT</button></div><input id="reject_${d.id}" placeholder="Rejection reason (required if rejecting)"></div>`}).join(''):'<div class="empty">No pending astrologer applications.</div>';
  Promise.all(pendingDocs.map(async d=>{try{const ps=await getDoc(doc(db,'smv_payouts',d.id));if(ps.exists()){const p=ps.data();$('payout_'+d.id).innerHTML=`<b>PRIVATE BANK/UPI:</b> Bank: ${escapeHtml(p.bankName||'')} · Holder: ${escapeHtml(p.accountName||'')} · Account: ${escapeHtml(p.accountNumber||'')} · IFSC: ${escapeHtml(p.ifsc||'')} · UPI: ${escapeHtml(p.upi||'')} · நிலை: ${escapeHtml(p.status||'')}`;}}catch(e){$('payout_'+d.id).textContent='Payout details unavailable.';}}));
  box.querySelectorAll('[data-approve]').forEach(b=>b.onclick=async()=>{const id=b.dataset.approve,price=Number($('price_'+id).value);if(!price||price<1){alert('Admin must set the consultation amount before approval. This amount is not shown publicly.');return;}await updateDoc(doc(db,'smv_astrologers',id),{status:'approved',pricePerQuestion:price,approvedAt:serverTimestamp(),approvedBy:currentUser.uid});await updateDoc(doc(db,'smv_users',id),{status:'active'});await setDoc(doc(db,'smv_notifications',id+'_approval_'+Date.now()),{userId:id,type:'approval',title:'Astrologer application approved',message:'Your profile has been approved by Admin.',createdAt:serverTimestamp(),read:false});loadAdminPanel();});
  box.querySelectorAll('[data-reject]').forEach(b=>b.onclick=async()=>{const id=b.dataset.reject,reason=$('reject_'+id).value.trim();if(!reason){alert('Enter rejection reason.');return;}await updateDoc(doc(db,'smv_astrologers',id),{status:'rejected',rejectionReason:reason,rejectedAt:serverTimestamp(),rejectedBy:currentUser.uid});await updateDoc(doc(db,'smv_users',id),{status:'rejected'});await setDoc(doc(db,'smv_notifications',id+'_reject_'+Date.now()),{userId:id,type:'rejection',title:'Astrologer application requires changes',message:reason,createdAt:serverTimestamp(),read:false});loadAdminPanel();});
  // Approved Astrologer payment-method changes awaiting Admin review.
  const payoutBox=$('adminPayoutChanges');
  Promise.resolve().then(async()=>{
    const payoutSnap=await withTimeout(getDocs(query(collection(db,'smv_payouts'),where('status','==','pending_admin_review'))),12000);
    const pendingPayouts=payoutSnap.docs.filter(d=>{const a=astros.docs.find(x=>x.id===d.id)?.data()||{};return String(a.status||'').toLowerCase()==='approved';}).slice().sort((a,b)=>smvAdminSortTime(b)-smvAdminSortTime(a));
    payoutBox.innerHTML=pendingPayouts.length?pendingPayouts.map(d=>{const p=d.data()||{};const a=astros.docs.find(x=>x.id===d.id)?.data()||{};return `<div class="card" style="margin:10px 0"><h3><span translate="no">${escapeHtml(a.name||d.id)}</span></h3><div class="small"><b>Astrologer ID:</b> ${escapeHtml(d.id)} · <b>Submitted:</b> ${escapeHtml(smvDateTime(p.requestedAt||p.updatedAt))}</div><div class="small" style="margin-top:8px"><b>PRIVATE PAYMENT DETAILS:</b> Bank: ${escapeHtml(p.bankName||'')} · Holder: ${escapeHtml(p.accountName||'')} · Account: ${escapeHtml(p.accountNumber||'')} · IFSC: ${escapeHtml(p.ifsc||'')} · UPI: ${escapeHtml(p.upi||'—')}</div><div class="action-row" style="margin-top:10px"><button class="btn" data-payout-approve="${escapeHtml(d.id)}">APPROVE</button><button class="btn gray" data-payout-reject="${escapeHtml(d.id)}">REJECT</button></div><input id="payoutReject_${escapeHtml(d.id)}" placeholder="Rejection reason (required if rejecting)"></div>`;}).join(''):'<div class="empty">No payment method changes waiting for Admin approval.</div>';
    payoutBox.querySelectorAll('[data-payout-approve]').forEach(b=>b.onclick=async()=>{const id=b.dataset.payoutApprove;b.disabled=true;try{const r=await withTimeout(renderApi('/admin/payout-change-status',{method:'POST',body:JSON.stringify({astrologerId:id,status:'approved'})}),15000);if(!r?.success)throw new Error(r?.error||'Unable to approve payment method.');alert('Payment method approved.');await loadAdminPanel();}catch(e){alert(e.message||String(e));b.disabled=false;}});
    payoutBox.querySelectorAll('[data-payout-reject]').forEach(b=>b.onclick=async()=>{const id=b.dataset.payoutReject,reason=$('payoutReject_'+id)?.value.trim()||'';if(!reason){alert('Enter rejection reason.');return;}b.disabled=true;try{const r=await withTimeout(renderApi('/admin/payout-change-status',{method:'POST',body:JSON.stringify({astrologerId:id,status:'rejected',reason})}),15000);if(!r?.success)throw new Error(r?.error||'Unable to reject payment method.');alert('Payment method rejected.');await loadAdminPanel();}catch(e){alert(e.message||String(e));b.disabled=false;}});
  }).catch(e=>{payoutBox.innerHTML='<div class="empty error">Payment method approval list could not be loaded right now.</div>';console.warn('Admin payout changes load skipped:',e);});

  // Public கேள்வி நிர்வாகி ஒப்புதல்: Admin selects exactly one approved astrologer and commission rate.
  const withdrawalSnap=await getDocs(collection(db,'smv_withdrawals'));
  const withdrawalDocs=withdrawalSnap.docs.slice().sort((a,b)=>Number(b.data().createdAt?.seconds||0)-Number(a.data().createdAt?.seconds||0)).slice(0,50);
  $('adminWithdrawals').innerHTML=withdrawalDocs.length?withdrawalDocs.map(d=>{const w=d.data();return `<div class="card" style="margin:10px 0"><b>₹${Number(w.amount||0).toFixed(2)}</b> · <b>${escapeHtml(w.status||'pending').toUpperCase()}</b><div class="small">ஜோதிடர்: ${escapeHtml(w.astrologerName||w.astrologerId||'')} · Astrologer ID: ${escapeHtml(w.astrologerId||'')}<br><b>Withdrawal ID:</b> ${escapeHtml(w.withdrawalId||'—')}${String(w.status||'').toLowerCase()==='paid' && /^SMV-PMT-/.test(String(w.adminPaymentId||'')) ? `<br><b>Admin Payment ID:</b> ${escapeHtml(w.adminPaymentId)}` : ''}<br>Requested: ${escapeHtml(smvDateTime(w.createdAt||w.requestedAt))}${String(w.status||'').toLowerCase()==='paid' && w.paidAt ? `<br><b>Paid தேதி & நேரம்:</b> ${escapeHtml(smvDateTime(w.paidAt))}` : ''}</div><div id="withdrawBank_${d.id}" class="small" style="margin-top:8px"><b>PRIVATE PAYMENT DETAILS:</b> Loading…</div><div class="action-row">${w.status==='pending'?`<button class="btn" data-wstatus="${d.id}" data-status="processing">MARK PROCESSING</button><button class="btn gray" data-wstatus="${d.id}" data-status="rejected">REJECT</button>`:''}${w.status==='processing'?`<button class="btn" data-wstatus="${d.id}" data-status="paid">MARK PAID</button>`:''}${String(w.status||'').toLowerCase()==='paid' && !/^SMV-PMT-/.test(String(w.adminPaymentId||''))?`<button class="btn" data-wstatus="${d.id}" data-status="paid">CREATE ADMIN PAYMENT ID</button>`:''}</div></div>`}).join(''):'<div class="empty">No withdrawal requests.</div>';
  await Promise.all(withdrawalDocs.map(async d=>{
    try{
      const p=await withTimeout(renderApi('/admin/withdrawal-payout/'+encodeURIComponent(d.id),{method:'GET'}),15000);
      const box=$('withdrawBank_'+d.id);
      if(box) box.innerHTML=p?.available?`<b>PRIVATE PAYMENT DETAILS:</b> Bank: ${escapeHtml(p.bankName||'')} · Holder: ${escapeHtml(p.accountName||'')} · Account: ${escapeHtml(p.accountNumber||'')} · IFSC: ${escapeHtml(p.ifsc||'')} · UPI: ${escapeHtml(p.upi||'—')}`:'<b>PRIVATE PAYMENT DETAILS:</b> Not available.';
    }catch(e){ const box=$('withdrawBank_'+d.id); if(box) box.textContent='Private payment details unavailable.'; console.warn('Withdrawal payout details load failed:',d.id,e); }
  }));
 $('adminWithdrawals')
  .querySelectorAll('[data-wstatus]')
  .forEach(b => {

    b.onclick = async () => {

      const withdrawalId =
        b.dataset.wstatus;

      const newStatus =
        b.dataset.status;

      b.disabled = true;
      b.textContent = 'UPDATING...';

      try {

        const withdrawalRef =
          doc(
            db,
            'smv_withdrawals',
            withdrawalId
          );

        const snap =
          await withTimeout(
            getDoc(withdrawalRef),
            15000
          );

        if(!snap.exists()){
          throw new Error(
            'Withdrawal request not found.'
          );
        }

        const w = snap.data();

        let adminPaymentId = String(w.adminPaymentId || w.paymentId || '');

        // IMPORTANT: SMV-PMT is created only when Admin actually marks the
        // withdrawal as PAID. Withdrawal request itself remains SMV-WDT.
        if(newStatus === 'paid'){
          const paidResult = await withTimeout(
            renderApi('/admin/withdrawal-mark-paid', {
              method:'POST',
              body:JSON.stringify({withdrawalDocId: withdrawalId})
            }),
            20000
          );
          adminPaymentId = String(paidResult.paymentId || '');
          if(!adminPaymentId) throw new Error('Admin Payment ID was not returned.');
        } else {
          const updateData = {
            status: newStatus,
            updatedAt: serverTimestamp(),
            updatedBy: currentUser.uid
          };

          if(newStatus === 'processing'){
            updateData.processingAt = serverTimestamp();
          }

          if(newStatus === 'rejected'){
            updateData.rejectedAt = serverTimestamp();
          }

          await withTimeout(
            updateDoc(withdrawalRef, updateData),
            15000
          );
        }

        if(w.astrologerId){

          let title = '';
          let message = '';

          if(newStatus === 'processing'){
            title =
              'Withdrawal is processing';
            message =
              `Your withdrawal request of ₹${Number(w.amount || 0).toFixed(2)} is being processed by Admin. Withdrawal ID: ${w.withdrawalId || withdrawalId}.`;
          }

          if(newStatus === 'paid'){
            title =
              'Withdrawal paid';
            message =
              `Your withdrawal of ₹${Number(w.amount || 0).toFixed(2)} has been marked as paid. Withdrawal ID: ${w.withdrawalId || withdrawalId}. Admin Payment ID: ${adminPaymentId}.`;
          }

          if(newStatus === 'rejected'){
            title =
              'Withdrawal rejected';
            message =
              `Your withdrawal request of ₹${Number(w.amount || 0).toFixed(2)} was rejected by Admin. Withdrawal ID: ${w.withdrawalId || withdrawalId}.`;
          }

          if(message){

            await setDoc(
              doc(
                db,
                'smv_notifications',
                w.astrologerId +
                '_withdrawal_' +
                Date.now()
              ),
              {
                userId:
                  w.astrologerId,

                type:
                  'withdrawal_' + newStatus,

                title:
                  title,

                message:
                  message,

                withdrawalId:
                  withdrawalId,

                adminPaymentId:
                  newStatus === 'paid' ? adminPaymentId : '',

                amount:
                  Number(w.amount || 0),

                createdAt:
                  serverTimestamp(),

                read:
                  false
              }
            );

          }

        }

        alert(
          newStatus === 'paid' && adminPaymentId
            ? `Withdrawal marked as paid. Admin Payment ID: ${adminPaymentId}`
            : `Withdrawal status updated to ${newStatus}.`
        );

        await loadAdminPanel();

      } catch(e) {

        console.error(
          'Withdrawal status error:',
          e
        );

        alert(
          e.message || String(e)
        );

        b.disabled = false;

        b.textContent =
          newStatus === 'processing'
            ? 'MARK PROCESSING'
            : newStatus === 'paid'
              ? 'MARK PAID'
              : 'REJECT';

      }

    };

  });
  /* ADMIN EARNINGS HISTORY — display-only ledger from credited answered questions. */
  try {
    const adminEarnedQuestions = questions.docs.filter(d=>{const q=d.data()||{};return q.status==='answered' && q.commissionStatus==='credited';});
    const creditedPayments = payments.docs.filter(d=>{const p=d.data()||{};return String(p.type||'').toLowerCase()==='astrologer_earning' && String(p.status||'').toLowerCase()==='credited';});
    let adminTotal=0;
    const questionLedgerIds=new Set();
    const earningsEntries=[];
    adminEarnedQuestions.forEach(d=>{const q=d.data()||{};questionLedgerIds.add(String(d.id));const paid=Number(q.amount||q.customerAmount||0);const astro=Number(q.astrologerCommissionAmount||q.commissionAmount||0);const adminEarn=Math.max(0,Math.round((paid-astro)*100)/100);adminTotal+=adminEarn;const dt=q.commissionCreditedAt||q.answerApprovedAt||q.adminAnswerApprovedAt||q.updatedAt||q.createdAt||null;const customer=q.customerName||q.birthName||q.birthDetails?.name||'Customer';earningsEntries.push({time:smvSortMillis(dt),html:`<div style="padding:12px 0;border-bottom:1px solid #eee"><div><b>₹${adminEarn.toFixed(2)}</b> <span class="success">Admin Earned</span></div><div class="small"><b>Customer:</b> ${escapeHtml(customer)} · <b>கேள்வி எண்:</b> ${escapeHtml(d.id)}</div><div class="small"><span translate="no">${escapeHtml(q.question||'ஆலோசனை')}</span></div><div class="small">Credited: ${escapeHtml(smvDateTime(dt))}</div></div>`});});
    creditedPayments.forEach(d=>{const p=d.data()||{};if(questionLedgerIds.has(String(p.questionId||''))) return;const gross=Number(p.grossAmount||0);const astro=Number(p.commissionAmount||p.earningAmount||0);const adminEarn=Math.max(0,Math.round((gross-astro)*100)/100);adminTotal+=adminEarn;const dt=p.creditedAt||p.createdAt||p.updatedAt||null;earningsEntries.push({time:smvSortMillis(dt),html:`<div style="padding:12px 0;border-bottom:1px solid #eee"><div><b>₹${adminEarn.toFixed(2)}</b> <span class="success">Admin Earned</span></div><div class="small"><b>Payment ID:</b> ${escapeHtml(p.paymentId||d.id)} · <b>கேள்வி எண்:</b> ${escapeHtml(p.questionId||'—')}</div><div class="small">Astrologer earning credited</div><div class="small">Credited: ${escapeHtml(smvDateTime(dt))}</div></div>`});});
    const adminRows=earningsEntries.sort((a,b)=>b.time-a.time).slice(0,50).map(x=>x.html).join('');
    
$('adminEarningsHistory').innerHTML=`<div class="stats-grid" style="margin-bottom:12px"><div class="stat">Total Admin Earnings <b>₹${adminTotal.toFixed(2)}</b></div><div class="stat">Completed ஆலோசனைs <b>${adminEarnedQuestions.length}</b></div></div>${adminRows||'<div class="empty">No credited admin earnings yet.</div>'}`;
  } catch(e) { console.warn('Admin earnings history load skipped:',e); if($('adminEarningsHistory'))$('adminEarningsHistory').innerHTML='<div class="empty">Admin earnings history could not be loaded right now.</div>'; }

  const reviewsSnap = await getDocs(
  collection(db, 'smv_reviews')
);

$('adminReviews').innerHTML =
  reviewsSnap.empty
    ? '<div class="empty">No reviews yet.</div>'
    : reviewsSnap.docs
        .slice()
        .sort((a,b)=>smvAdminSortTime(b)-smvAdminSortTime(a))
        .slice(0,50)
        .map(d => {

          const r = d.data();

          return `
            <div style="padding:10px;border-bottom:1px solid #eee">

              <div>
                ⭐ <b>${Number(r.rating || 0)}/5</b>
              </div>

              <div style="margin-top:5px">
                <span translate="no">${escapeHtml(r.review || '')}</span>
              </div>

              <div class="small" style="margin-top:5px">
                Verified customer ·
                ஜோதிடர்:
                ${escapeHtml(r.astrologerId || '')}
                · நிலை:
                <b>
                  ${r.approved === true
                    ? 'Approved'
                    : 'நிலுவையில் உள்ளது'}
                </b>
              </div>

              <div class="action-row">

                <button
                  class="btn"
                  data-review-edit="${d.id}">
                  EDIT REVIEW
                </button>

                ${
                  r.approved === true
                    ? ''
                    : `
                      <button
                        class="btn"
                        data-review-approve="${d.id}">
                        APPROVE REVIEW
                      </button>

                      <button
                        class="btn gray"
                        data-review-reject="${d.id}">
                        REJECT REVIEW
                      </button>
                    `
                }

              </div>

            </div>
          `;

        })
        .join('');


/* EDIT REVIEW + RATING */

$('adminReviews')
  .querySelectorAll('[data-review-edit]')
  .forEach(b => {

    b.onclick = async () => {

      const reviewId =
        b.dataset.reviewEdit;

      try {

        const reviewRef =
          doc(
            db,
            'smv_reviews',
            reviewId
          );

        const snap =
          await withTimeout(
            getDoc(reviewRef),
            15000
          );

        if (!snap.exists()) {
          throw new Error(
            'Review not found.'
          );
        }

        const r =
          snap.data();

        openModal(`
          <h2>Edit Customer Review</h2>

          <label>Rating</label>

          <select id="editReviewRating">
            <option value="5"
              ${Number(r.rating) === 5 ? 'selected' : ''}>
              ★★★★★ — 5
            </option>

            <option value="4"
              ${Number(r.rating) === 4 ? 'selected' : ''}>
              ★★★★☆ — 4
            </option>

            <option value="3"
              ${Number(r.rating) === 3 ? 'selected' : ''}>
              ★★★☆☆ — 3
            </option>

            <option value="2"
              ${Number(r.rating) === 2 ? 'selected' : ''}>
              ★★☆☆☆ — 2
            </option>

            <option value="1"
              ${Number(r.rating) === 1 ? 'selected' : ''}>
              ★☆☆☆☆ — 1
            </option>
          </select>

          <label style="display:block;margin-top:10px">
            Review
          </label>

          <textarea
            id="editReviewText"
            placeholder="Customer review"
            style="width:100%;min-height:120px"
          >${escapeHtml(r.review || '')}</textarea>

          <button
            class="btn"
            id="saveEditedReview"
            style="margin-top:10px">
            SAVE CHANGES
          </button>

          <div
            id="editReviewMsg"
            class="small"
            style="margin-top:8px">
          </div>
        `);

        $('saveEditedReview').onclick =
          async () => {

            const saveBtn =
              $('saveEditedReview');

            const msg =
              $('editReviewMsg');

            const rating =
              Number(
                $('editReviewRating').value
              );

            const review =
              $('editReviewText')
                .value
                .trim();

            if (
              rating < 1 ||
              rating > 5
            ) {
              msg.innerHTML =
                '<span class="error">Please select a valid rating.</span>';
              return;
            }

            if (!review) {
              msg.innerHTML =
                '<span class="error">Review cannot be empty.</span>';
              return;
            }

            saveBtn.disabled = true;
            saveBtn.textContent =
              'SAVING...';

            try {

              await withTimeout(
                updateDoc(
                  reviewRef,
                  {
                    rating:
                      rating,

                    review:
                      review,

                    updatedAt:
                      serverTimestamp(),

                    updatedBy:
                      currentUser.uid
                  }
                ),
                15000
              );

              msg.innerHTML =
                '<span class="success">Review updated successfully.</span>';

              setTimeout(() => {
                closeModal();
                loadAdminPanel();
              }, 500);

            } catch (e) {

              msg.innerHTML =
                '<span class="error">' +
                escapeHtml(
                  e.message || String(e)
                ) +
                '</span>';

              saveBtn.disabled = false;
              saveBtn.textContent =
                'SAVE CHANGES';
            }

          };

      } catch (e) {

        alert(
          e.message || String(e)
        );

      }

    };

  });


/* APPROVE REVIEW */

$('adminReviews')
  .querySelectorAll('[data-review-approve]')
  .forEach(b => {

    b.onclick = async () => {

      b.disabled = true;

      try {

        await withTimeout(
          updateDoc(
            doc(
              db,
              'smv_reviews',
              b.dataset.reviewApprove
            ),
            {
              approved:
                true,

              status:
                'approved',

              approvedAt:
                serverTimestamp(),

              approvedBy:
                currentUser.uid
            }
          ),
          15000
        );

        await loadAdminPanel();

      } catch (e) {

        alert(
          e.message || String(e)
        );

        b.disabled = false;
      }

    };

  });


/* REJECT REVIEW */

$('adminReviews')
  .querySelectorAll('[data-review-reject]')
  .forEach(b => {

    b.onclick = async () => {

      const choice = await smvConfirm(
        'Reject Customer Review',
        'This review will be permanently deleted.\n\nChoose Reject & Delete to continue.',
        'REJECT & DELETE',
        'CANCEL',
        true
      );

      if (!choice) {
        return;
      }

      b.disabled = true;
      b.textContent = 'REJECTING...';

      try {

        await withTimeout(
          deleteDoc(
            doc(
              db,
              'smv_reviews',
              b.dataset.reviewReject
            )
          ),
          15000
        );

        smvNotice('Review Deleted','The customer review was rejected and deleted successfully.','✓');

        await loadAdminPanel();

      } catch (e) {

        smvNotice('Unable to Reject Review',e.message || String(e),'!');

        b.disabled = false;
        b.textContent = 'REJECT REVIEW';
      }

    };

  });
  $('adminQuestions').innerHTML=questions.empty?'<div class="empty">No questions yet.</div>':questions.docs.slice().sort((a,b)=>smvAdminSortTime(b)-smvAdminSortTime(a)).slice(0,50).map(d=>{const q=d.data();return `<div style="padding:10px;border-bottom:1px solid #eee"><b><span translate="no">${escapeHtml(q.question||'கேள்வி')}</span></b><div class="small">நிலை: ${escapeHtml(q.status||'')} · Customer: ${escapeHtml(q.customerId||'')} · Price paid: ₹${Number(q.amount||0).toFixed(2)} · Astrologer share: ₹${Number(q.astrologerCommissionAmount||0).toFixed(2)} · Admin share: ₹${Number(q.adminCommissionAmount||0).toFixed(2)} · ${escapeHtml(q.astrologerName||'Unclaimed')}</div><div class="small"><b>தேதி & நேரம்:</b> ${escapeHtml(smvDateTime(q.updatedAt||q.answerApprovedAt||q.adminQuestionApprovedAt||q.createdAt))}</div></div>`}).join('');
 }catch(e){
 const message='<div class="empty error">'+escapeHtml(e.message||String(e))+'</div>';
 if($('adminDataLoadMsg'))$('adminDataLoadMsg').innerHTML=message;
 for(const id of ['adminPendingQuestions','adminAnswers','adminRefunds']){const el=$(id);if(el&&!el.querySelector('[data-question]'))el.innerHTML=message;}
 }
}
if(auth){ onAuthStateChanged(auth,async user=>{
   const previousUid=lastAuthUid;
   const nextUid=user?.uid||null;
   const identityChanged=previousUid!==nextUid;
   if(identityChanged){
     ++dashboardSessionGeneration;
     ++dashboardLoadSeq; dashboardLoadPromise=null; dashboardLoadUid=null;
     dashboardShellUid=null; dashboardReadyUid=null; dashboardReadyRole=null;
   }
   currentUser=user; window.__smvFirebaseCurrentUser=user||null; window.__smvCurrentUserPresent=!!user;
   if(authReadyResolve){authReadyResolve();authReadyResolve=null;}
   if(identityChanged){
     // Never expose the previous user's dashboard. For a fresh normal login,
     // however, submitAuth() has marked the new UID as a dashboard bootstrap;
     // keep the new shell visible while role/profile data is hydrated.
     const keepDashboardBootstrap=!!user && (
       window.__SMV_DASHBOARD_BOOTSTRAP_UID===user.uid ||
       window.__SMV_DASHBOARD_BOOTSTRAP_UID==="__PENDING__"
     );
     if(!keepDashboardBootstrap){
       hide('dashboard'); hide('dashboardContent');
     }else{
       // The new user's shell will be rendered immediately after verification;
       // never leave the previous user's dashboard content on screen.
       hide('dashboardContent');
     }
     hide('admin'); hide('dashLink'); hide('adminLink');
     setHeaderRoleLabel('');
   }
   $('authBtn').textContent=user?'வெளியேறு':'உள்நுழைவு';
   if(user){
     intentionalLogout=false;
     hide('smv-content-hub'); window.__smvContentVisible=false;
     lastAuthUid=user.uid; window.__SMV_LOGGED_OUT=false; touchSession(); armIdleTimer(); window.dispatchEvent(new Event('smv:auth-user'));
     if(user.uid!==ADMIN_UID && !user.emailVerified){ await signOut(auth); currentUser=null; clearIdleTimer(); lastAuthUid=null; hide("dashboard"); hide("admin"); hide("dashLink"); hide("adminLink"); $("authBtn").textContent="உள்நுழைவு"; return; }
      // Normal Customer/Astrologer sessions should see the dashboard shell now,
      // not wait for Firestore role/profile/question hydration.
      const bootstrapRole=(()=>{
        try{
          const c=JSON.parse(sessionStorage.getItem("smv_login_role")||"null");
          return c?.uid===user.uid?String(c.role||"").toLowerCase():"";
        }catch(_e){return "";}
      })();
      if(user.uid!==ADMIN_UID && bootstrapRole!=="admin"){
        show("dashLink");
        hide("adminLink");
        hidePrimarySections("dashboard");
        show("dashboard");
        show("dashboardContent");
        renderDashboardShell(bootstrapRole);
        smvShowRoleNav();
        smvInternalView="dashboard";
        dashboardShellUid=user.uid;
        try{history.replaceState({smvView:"dashboard"},"","#dashboard");}catch(_e){}
        go("dashboard");
      }
      // CUSTOMER DASHBOARD SINGLE-VISIBLE-LOAD LOCK:
      // If Firebase re-enters auth state for the same signed-in user while the
      // dashboard is already loading or rendered, do not replace it with a new
      // Loading screen or start another automatic dashboard hydration.
      if(previousUid===user.uid && smvInternalView==='dashboard' && dashboardShellUid===user.uid){
        armIdleTimer();
        return;
      }
     // ASK NOW login has a protected destination. Let submitAuth() continue
     // to Customer Dashboard + கேள்வி Form instead of this normal dashboard-only path.
     // Never let a late auth-state callback replace an already-open கேள்வி Form.
     // This protects the second and later Home -> ASK NOW cycles.
     if(pendingAfterLogin==='question' || window.__SMV_ASK_NOW_INTENT===true || askNowTransitionLock || smvInternalView==='ask-flow'){
       // ASK NOW owns this auth transition. NEVER fall through to the normal
       // login -> Dashboard renderer while the protected கேள்வி Form route
       // is active or being completed.
       armIdleTimer();
       return;
     }
     // Re-check immediately before any automatic dashboard navigation. This is
     // intentionally duplicated after async auth/profile work to close the race
     // window where ASK NOW can start while this callback is already suspended.
     if(pendingAfterLogin==='question' || window.__SMV_ASK_NOW_INTENT===true || askNowTransitionLock || smvInternalView==='ask-flow'){
       armIdleTimer();
       return;
     }
     const listenerEpoch=smvNavigationEpoch;
     // Do NOT call isCurrentAdmin() here. That function calls the protected
     // Render /admin-data endpoint first, which is unnecessary for normal
     // Astrologer/Customer login and can make Admin -> Logout -> Astrologer
     // login appear stuck on "Loading your dashboard...". Firebase UID plus
     // the user's Firestore role are sufficient for this client-side router.
     let cachedRole='';
     try{
       const cached=JSON.parse(sessionStorage.getItem("smv_login_role")||"null");
       if(cached?.uid===user.uid) cachedRole=String(cached.role||'').toLowerCase();
     }catch(_e){}
     // Resolve role without making Astrologer login wait on an Admin-only API.
     // When no cached role is available, profile and astrologer documents are read in parallel.
     let headerRole=cachedRole;
     if(!headerRole){
       const profileP=withTimeout(getDoc(doc(db,'smv_users',user.uid)),8000).catch(()=>null);
       const astroP=withTimeout(getDoc(doc(db,'smv_astrologers',user.uid)),8000).catch(()=>null);
       const [hp,ha]=await Promise.all([profileP,astroP]);
       const pr=hp?.exists()?String(hp.data()?.role||'').toLowerCase():'';
       headerRole=pr || (ha?.exists()?'astrologer':'customer');
       if(headerRole==='astrologer'){ astroDashboardBootstrap={uid:user.uid,userData:hp?.exists()?(hp.data()||{}):{},astroData:ha?.exists()?(ha.data()||{}):{}}; }
       try{sessionStorage.setItem("smv_login_role",JSON.stringify({uid:user.uid,role:headerRole}));}catch(_e){}
     }
     const adminUser=(user.uid===ADMIN_UID || headerRole==='admin');
     setHeaderRoleLabel(headerRole);
     // CRITICAL LATE-RACE GUARD: ASK NOW may have started while the auth
     // listener was awaiting Firebase/profile data. Never let this older
     // listener resume and overwrite the கேள்வி Form with Dashboard.
     if(listenerEpoch!==smvNavigationEpoch || pendingAfterLogin==='question' || askNowTransitionLock || smvInternalView==='ask-flow'){
       armIdleTimer();
       return;
     }
     if(adminUser){
       hide('dashLink'); show('adminLink'); smvShowRoleNav(); smvInternalView="admin";
       try{history.replaceState({smvView:"admin"},"","#admin");}catch(_e){}
     }      else {
       const role=headerRole==='astrologer'?'astrologer':'customer';
       // Firebase has resolved this exact UID's role. Open ONLY that role's shell.
       if(user.uid!==lastAuthUid) return;
       show('dashLink'); hide('adminLink');
       hidePrimarySections('dashboard');
       show('dashboard');
       show('dashboardContent');
       renderDashboardShell(role);
       smvShowRoleNav(); smvInternalView="dashboard";
       dashboardShellUid=user.uid;
       try{history.replaceState({smvView:"dashboard"},"","#dashboard");}catch(_e){}
       go('dashboard');
       // Background hydrate only. Generation + UID guards reject older sessions.
       try{ if(window.__SMV_DASHBOARD_BOOTSTRAP_UID===user.uid) delete window.__SMV_DASHBOARD_BOOTSTRAP_UID; }catch(_e){}
       setTimeout(()=>loadDashboard(role).catch(err=>console.warn('Initial dashboard load skipped:',err)),120);
      }
   }else{
     window.__smvCurrentUserPresent=false;
     clearIdleTimer(); lastAuthUid=null;
     hide('dashLink');hide('adminLink');hide('dashboard');hide('admin');
     setHeaderRoleLabel('');
     show('smv-content-hub'); window.__smvContentVisible=false;
     showHomeSurface();
     smvInternalView="home";
   }
 }); }
if(firebaseInitError){
  console.error("SMV ASTRO Firebase is unavailable. Basic navigation is still available.",firebaseInitError);
}

window.__SMV_APP_READY=true;
