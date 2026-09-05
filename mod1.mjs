(function(){
  const BACKEND="https://smv-astro-1fco.onrender.com";
  const FBCONFIG={apiKey:"AIzaSyCKXyfZ9sjGmej7ygxHpzHNcNysMXHuvSs",authDomain:"smv-astro.firebaseapp.com",projectId:"smv-astro",storageBucket:"smv-astro.firebasestorage.app",messagingSenderId:"299081899217",appId:"1:299081899217:web:8d558df08e86037ea539f0"};
  let db=null,auth=null;
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let fbApi=null;
  function withTimeout(promise,ms=15000){return Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Firebase did not respond within 15 seconds.')),ms))]);}
  async function fb(){
    if(db&&auth&&fbApi) return fbApi;
    const {getApps,initializeApp}=await import('https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js');
    const fs=await import('https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js');
    const {getFirestore}=fs;
    const {getAuth,setPersistence,browserSessionPersistence}=await import('https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js');
    const app=getApps().length?getApps()[0]:initializeApp(FBCONFIG);
    db=getFirestore(app);
    auth=getAuth(app);await setPersistence(auth,browserSessionPersistence);
    fbApi={
      collection:fs.collection,getDocs:fs.getDocs,query:fs.query,where:fs.where,orderBy:fs.orderBy,limit:fs.limit,
      doc:fs.doc,getDoc:fs.getDoc,addDoc:fs.addDoc,updateDoc:fs.updateDoc,deleteDoc:fs.deleteDoc,
      setDoc:fs.setDoc,serverTimestamp:fs.serverTimestamp
    };
    return fbApi;
  }
  async function loadQuestionPrice(){try{const f=await fb();const snap=await f.getDoc(f.doc(db,'smv_settings','question'));if(!snap.exists())throw new Error('Question price is not configured.');const price=Number(snap.data()?.price);if(!Number.isFinite(price)||price<1)throw new Error('Invalid question price.');if($('publicQuestionPrice'))$('publicQuestionPrice').textContent='₹'+price.toFixed(2);}catch(e){console.warn('Public question price unavailable:',e);if($('publicQuestionPrice'))$('publicQuestionPrice').textContent='Price unavailable';}}
  function showPublicProfileModal(html){
    const modalEl=document.getElementById('modal');
    const contentEl=document.getElementById('modalContent');
    if(!modalEl||!contentEl) throw new Error('Profile dialog is unavailable.');
    contentEl.innerHTML=html;
    modalEl.classList.add('profile-modal-active');
    modalEl.classList.remove('hidden');
    return modalEl;
  }
  async function openPublicAstrologerProfile(a){
    const name=a?.name||'Astrologer';
    try{
      /* Build the profile from the already-loaded astrologer card first.
         Do NOT wait for Firebase before opening the profile. */
      const stars=n=>'★'.repeat(Math.max(0,Math.min(5,Number(n||0))))+'☆'.repeat(5-Math.max(0,Math.min(5,Number(n||0))));
      const photo=a?.photoData||a?.photoURL||a?.photoUrl||'';
      showPublicProfileModal(`<div class="profile-dialog">${photo?`<img class="profile-photo" src="${esc(photo)}" alt="${esc(name)}">`:''}<h2 class="profile-title">${esc(name)}</h2><p class="profile-expertise">${esc(a?.expertise||a?.specialization||'Astrology')}</p><p class="profile-experience">⭐ ${esc(a?.experience||'Experienced')} years experience</p><p class="profile-bio">${esc(a?.bio||a?.about||'Professional astrologer')}</p><h3 class="profile-reviews-title">Verified Reviews</h3><div id="publicProfileReviews"><div class="empty">Loading reviews...</div></div><button class="btn gray" id="profileCloseBtn">CLOSE</button></div>`);
      $('profileCloseBtn').onclick=closeModal;

      let reviews=[];
      try{
        const reviewResponse=await withTimeout(fetch(RAZORPAY_BACKEND_URL+"/public/astrologers/"+encodeURIComponent(a.id)+"/reviews",{cache:"no-store"}),10000);
        const reviewData=await reviewResponse.json().catch(()=>({}));
        if(!reviewResponse.ok) throw new Error(reviewData.error||`Review service returned HTTP ${reviewResponse.status}.`);
        reviews=Array.isArray(reviewData.reviews)?reviewData.reviews:[];
      }catch(reviewApiError){
        console.warn('Public review API unavailable; using Firestore fallback:',reviewApiError);
        try{
          const f=await fb();
          const snap=await withTimeout(f.getDocs(f.query(f.collection(db,'smv_reviews'),f.where('astrologerId','==',a.id),f.where('approved','==',true))),10000);
          reviews=snap.docs.map(d=>({id:d.id,...(d.data()||{})}));
        }catch(firestoreError){
          console.warn('Firestore review fallback unavailable:',firestoreError);
          reviews=[];
        }
      }
      const reviewBox=$('publicProfileReviews');
      if(!reviewBox)return;
      reviewBox.innerHTML=reviews.length?reviews.map(r=>`<div class="card" style="margin:10px 0"><div class="stars">${stars(r.rating)}</div><p style="white-space:pre-wrap">“${esc(r.review||'Verified customer review')}”</p><p class="small">Verified customer</p></div>`).join(''):'<div class="empty">No approved reviews for this astrologer yet.</div>';
    }catch(e){
      console.error('Public astrologer profile open failed:',e);
      const m=document.getElementById('modal'),c=document.getElementById('modalContent');
      if(m&&c){c.innerHTML=`<h2>${esc(name)}</h2><div class="empty error">Unable to load this astrologer profile right now.</div><button class="btn gray" id="profileRetryBtn">TRY AGAIN</button><button class="btn gray" id="profileCloseBtn">CLOSE</button>`;m.classList.remove('hidden');document.getElementById('profileRetryBtn')?.addEventListener('click',()=>{m.classList.add('hidden');openPublicAstrologerProfile(a);},{once:true});document.getElementById('profileCloseBtn')?.addEventListener('click',closeModal,{once:true});}
    }
  }
  window.__smvOpenPublicAstrologerProfile=openPublicAstrologerProfile;
  async function loadReviews(){
    const box=$('publicReviews');if(!box)return;
    try{
      const f=await fb();
      const snap=await f.getDocs(f.query(f.collection(db,'smv_reviews'),f.where('approved','==',true),f.limit(12)));
      if(snap.empty){box.innerHTML='<div class="empty">No public reviews yet. Be the first verified customer to share your experience.</div>';return;}
      const reviews=await Promise.all(snap.docs.map(async d=>{
        const r=d.data();
        let astro={}; let customer={};
        try{if(r.astrologerId){const a=await f.getDoc(f.doc(db,'smv_astrologers',r.astrologerId));if(a.exists())astro=a.data()||{};}}catch(e){console.warn('Astrologer profile lookup failed',e);}
        try{if(r.customerId){const c=await f.getDoc(f.doc(db,'smv_users',r.customerId));if(c.exists())customer=c.data()||{};}}catch(e){console.warn('Customer profile lookup failed',e);}
        const stars='★'.repeat(Math.max(0,Math.min(5,Number(r.rating||0))))+'☆'.repeat(5-Math.max(0,Math.min(5,Number(r.rating||0))));
        const astroName=astro.name||r.astrologerName||'SMV ASTRO Astrologer';
        const astroPhoto=astro.photoData||astro.photoURL||astro.photoUrl||'';
        const customerName=customer.name||customer.displayName||r.customerName||'Verified Customer';
        const photo=astroPhoto?`<img src="${esc(astroPhoto)}" alt="${esc(astroName)}" style="width:58px;height:58px;border-radius:50%;object-fit:cover;border:2px solid var(--gold);">`:`<div style="width:58px;height:58px;border-radius:50%;display:grid;place-items:center;background:#f7df9b;color:#7b1e1e;font-weight:800;font-size:22px;border:2px solid var(--gold);">${esc(String(astroName).charAt(0).toUpperCase())}</div>`;
        return `<div class="card review-card"><div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">${photo}<div><div style="font-weight:800;font-size:18px">${esc(astroName)}</div><div class="small">Astrologer</div></div></div><div class="stars">${stars}</div><p style="white-space:pre-wrap">“${esc(r.review||'Verified customer review')}”</p><p class="small"><b>Customer: ${esc(customerName)}</b></p></div>`;
      }));
      box.innerHTML=reviews.join('');
    }catch(e){console.error('Public reviews load failed',e);box.innerHTML='<div class="empty">Reviews are temporarily unavailable.</div>';}
  }
  async function authHeaders(){await fb();const u=auth?.currentUser;if(!u)throw new Error('Please login as Admin to use this feature.');return {Authorization:'Bearer '+await u.getIdToken()};}
  // ADMIN TAKEOVER: if an allocated astrologer does not answer, Admin can edit the question and answer it.
  const takeoverQuestions = questions.docs.filter(d => {
    const q=d.data()||{};
    return q.customerId && !q.answer && (['paid','admin_approved','processing','answer_draft','admin_review'].includes(q.status) || ['assigned_to_astrologer','reallocated'].includes(q.allocationStatus));
  });
  const takeoverHtml = takeoverQuestions.length ? takeoverQuestions.map(d=>{
    const q=d.data()||{};
    return `<div class="card" style="margin:10px 0;border-left:4px solid var(--gold)">
      <div><b>Question ID: ${escapeHtml(d.id)}</b></div>
      <div class="small">Allocated Astrologer: ${escapeHtml(q.astrologerName||q.astrologerId||'Not assigned')}</div>
      <label style="display:block;margin-top:10px"><b>Re-allocate to another approved Astrologer</b></label>
      <div class="action-row"><select id="reallocAstro_${d.id}"><option value="">Select another approved astrologer</option>${astros.docs.filter(a=>a.id!==q.astrologerId && a.data()?.status==='approved').map(a=>{const x=a.data()||{};return `<option value="${escapeHtml(a.id)}">${escapeHtml(x.name||'Astrologer')} — ${escapeHtml(x.expertise||x.specialization||'Astrology')}</option>`}).join('')}</select><input id="reallocCommission_${d.id}" type="number" min="0" max="100" step="0.01" value="${Number(q.commissionPercent||q.commissionRate||settings.astroPercent||20)}" placeholder="Commission %"><button class="btn gray" data-keep-question="${d.id}">KEEP ALLOCATED</button><button class="btn gray" data-reallocate-question="${d.id}">RE-ALLOCATE</button></div>
      <label style="display:block;margin-top:10px"><b>Edit Question</b></label>
      <textarea id="adminQEdit_${d.id}" style="min-height:90px">${escapeHtml(q.question||'')}</textarea>
      <label style="display:block;margin-top:10px"><b>Admin Answer</b></label>
      <textarea id="adminAns_${d.id}" style="min-height:180px" placeholder="Admin can answer this question if the allocated astrologer is not responding."></textarea>
      <div class="small" id="adminTakeCount_${d.id}">0 words</div>
      <div class="action-row" style="margin-top:10px">
        <button class="btn gray" data-admin-edit-question="${d.id}">SAVE QUESTION EDIT</button>
        <button class="btn" data-admin-takeover="${d.id}">ADMIN ANSWER & CLOSE</button>
      </div>
      <div class="small">If Admin answers, the full customer payment is retained by Admin. No astrologer commission/payment ID will be created for this question.</div>
    </div>`;
  }).join('') : '<div class="empty">No unanswered allocated questions available for Admin takeover.</div>';
  if(answerBox){
    const takeoverCard=document.createElement('div');
    takeoverCard.className='card';
    takeoverCard.style.marginTop='16px';
    takeoverCard.innerHTML='<h3>Allocated Questions — Admin Control</h3><p class="small"><b>Question remains in this Admin Question panel after approval and allocation.</b> It stays here until an answer is submitted and approved. For every unanswered question Admin has three choices: <b>KEEP ALLOCATED</b>, <b>RE-ALLOCATE</b> to another approved astrologer, or <b>ADMIN ANSWER</b>.</p>'+takeoverHtml;
    answerBox.appendChild(takeoverCard);
    takeoverCard.querySelectorAll('[data-keep-question]').forEach(btn=>btn.onclick=()=>{btn.textContent='KEPT ALLOCATED';btn.disabled=true;alert('Question remains assigned to the current astrologer. It will stay in Admin control until an answer is submitted.');});
    takeoverCard.querySelectorAll('[data-reallocate-question]').forEach(btn=>btn.onclick=async()=>{
      const id=btn.dataset.reallocateQuestion; const astroId=$("reallocAstro_"+id)?.value||''; const pct=Number($("reallocCommission_"+id)?.value);
      if(!astroId){alert('Select another approved astrologer.');return;}
      if(!Number.isFinite(pct)||pct<0||pct>100){alert('Enter a valid commission percentage.');return;}
      const astroDoc=astros.docs.find(x=>x.id===astroId); const astro=astroDoc?.data()||{};
      btn.disabled=true; btn.textContent='ALLOCATING...';
      try{
        const qRef=doc(db,'smv_questions',id); const snap=await getDoc(qRef); if(!snap.exists()) throw new Error('Question not found.'); const q=snap.data()||{};
        const amount=Number(q.amount||0); const astroCommission=Math.round(amount*pct)/100; const adminCommission=Math.round((amount-astroCommission)*100)/100;
        await updateDoc(qRef,{astrologerId:astroId,astrologerName:astro.name||'Astrologer',commissionPercent:pct,commissionRate:pct,astrologerCommissionAmount:astroCommission,adminCommissionAmount:adminCommission,allocationStatus:'assigned_to_astrologer',commissionStatus:'allocated_pending_answer',reallocatedAt:serverTimestamp(),reallocatedBy:currentUser.uid,answer:null,answerWordCount:0,astrologerAnswerStatus:'pending'});
        await setDoc(doc(db,'smv_notifications',astroId+'_question_reassigned_'+Date.now()),{userId:astroId,type:'question_reassigned',title:'Question Re-assigned by Admin',message:'A paid question has been re-assigned to you by Admin.',questionId:id,commissionAmount:astroCommission,createdAt:serverTimestamp(),read:false});
        alert('Question re-allocated to '+(astro.name||'the selected astrologer')+'. Same Question ID retained.'); await loadAdminPanel();
      }catch(e){alert(e.message||String(e));btn.disabled=false;btn.textContent='RE-ALLOCATE';}
    });
    takeoverCard.querySelectorAll('[data-admin-edit-question]').forEach(btn=>btn.onclick=async()=>{
      const id=btn.dataset.adminEditQuestion;
      btn.disabled=true;
      try{const r=await renderApi('/admin/edit-question',{method:'POST',body:JSON.stringify({questionId:id,question:$('adminQEdit_'+id).value.trim()})}); if(!r?.success) throw new Error(r?.error||'Unable to edit question.'); alert('Question updated successfully.'); await loadAdminPanel();}
      catch(e){alert(e.message||String(e));btn.disabled=false;}
    });
    takeoverCard.querySelectorAll('[data-admin-takeover]').forEach(btn=>btn.onclick=async()=>{
      const id=btn.dataset.adminTakeover, ans=$('adminAns_'+id)?.value.trim()||'';
      const words=ans.split(/\s+/).filter(Boolean).length;
      if(!ans){alert('Please enter the Admin answer.');return;}
      if(words<Number((questions.docs.find(x=>x.id===id)?.data()?.answerMinWords)||1)){alert('Please meet the minimum answer word count.');return;}
      btn.disabled=true;btn.textContent='SAVING...';
      try{const r=await renderApi('/admin/takeover-answer',{method:'POST',body:JSON.stringify({questionId:id,answer:ans})}); if(!r?.success) throw new Error(r?.error||'Unable to save Admin answer.'); alert('Admin answer saved. Full customer payment is retained by Admin.'); await loadAdminPanel();}
      catch(e){alert(e.message||String(e));btn.disabled=false;btn.textContent='ADMIN ANSWER & CLOSE';}
    });
  }

  let adminAppointmentsLoading=false;
  async function loadAdminAppointments(){
    const box=$('adminAppointments'); if(!box||adminAppointmentsLoading)return;
    adminAppointmentsLoading=true; box.innerHTML='<div class="empty">Loading appointment requests...</div>';
    try{
      await fb(); const u=auth?.currentUser; if(!u)throw new Error('Please login as Admin.');
      const token=await u.getIdToken(true);
      const r=await withTimeout(fetch(BACKEND_URL+'/admin/appointments',{headers:{Authorization:'Bearer '+token},cache:'no-store'}),12000);
      const d=await r.json().catch(()=>({})); if(!r.ok)throw new Error(d.error||`Appointment service returned HTTP ${r.status}.`);
      const items=Array.isArray(d.appointments)?d.appointments:[];
      if(!items.length){box.innerHTML='<div class="empty">No appointment requests.</div>';return;}
      box.innerHTML=items.map(a=>{const current=String(a.status||'new').toLowerCase();return `<div style="padding:14px 0;border-bottom:1px solid #eee"><b>${esc(a.name||'Customer')}</b> · <b>${esc(a.type||'Consultation')}</b><div class="small">${esc(a.email||'')} · ${esc(a.mobile||'')}</div><div class="small">Preferred: <b>${esc(a.preferredDate||'-')}</b> ${esc(a.preferredTime||'')}</div><div class="small">${esc(a.notes||'No notes')}</div><div class="small" style="margin-top:6px">Status: <b>${esc(current.toUpperCase())}</b></div><div class="action-row">${['new','confirmed','completed','cancelled'].map(st=>`<button type="button" class="btn ${st==='cancelled'?'gray':''}" data-apstatus="${esc(a.id)}" data-status="${st}" ${st===current?'disabled style="opacity:.65;cursor:default"':''}>${st===current?'✓ ':''}${st.toUpperCase()}</button>`).join('')}</div></div>`;}).join('');
      box.querySelectorAll('[data-apstatus]').forEach(b=>b.onclick=()=>updateAppointment(b.dataset.apstatus,b.dataset.status,b));
    }catch(e){console.error('ADMIN APPOINTMENT ERROR:',e);box.innerHTML='<div class="empty error">Appointment loading failed: '+esc(e?.message||String(e))+'</div>';}finally{adminAppointmentsLoading=false;}
  }
  let appointmentUpdating=false;
  async function updateAppointment(id,status,button){
    if(appointmentUpdating)return; appointmentUpdating=true;
    const buttons=[...document.querySelectorAll('[data-apstatus]')]; buttons.forEach(x=>x.disabled=true);
    try{await fb();const u=auth?.currentUser;if(!u)throw new Error('Please login as Admin.');const token=await u.getIdToken(true);const r=await fetch(BACKEND_URL+'/admin/appointment-status',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({id,status}),cache:'no-store'});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||`Appointment update returned HTTP ${r.status}.`);await loadAdminAppointments();}catch(e){console.error('Appointment update error:',e);alert(e?.message||String(e));buttons.forEach(x=>x.disabled=false);}finally{appointmentUpdating=false;}
  }

  window.__smvSetupLanguage = function setupLanguage(){
    const select=$('langSelect');
    if(!select || select.dataset.smvLangBound==='1') return;
    select.dataset.smvLangBound='1';
    let currentLang='en';
    const T={
      'Home':'முகப்பு','Contact':'தொடர்பு','Dashboard':'டாஷ்போர்டு','Admin':'நிர்வாகி','Login':'உள்நுழைவு','Logout':'வெளியேறு','Register':'பதிவு','Close':'மூடு','Back':'பின்','← Back':'← பின்','← Back to Home':'← முகப்பிற்குத் திரும்பு','FAQ':'அடிக்கடி கேட்கப்படும் கேள்விகள்',
      'ASTROLOGY CONSULTATION':'ஜோதிட ஆலோசனை','VEDA • JYOTISHA • GUIDANCE':'வேதம் • ஜோதிடம் • வழிகாட்டல்','WELCOME TO SMV ASTRO SERVICES':'SMV ASTRO சேவைகளுக்கு வரவேற்கிறோம்','Trusted Astrological Guidance for a Better Tomorrow':'சிறந்த நாளைக்கான நம்பகமான ஜோதிட வழிகாட்டல்','Rooted in the time-honoured Indian tradition of Jyotisha, we bring thoughtful astrological guidance for life, relationships, career and important decisions — with trusted astrologers and a private consultation experience.':'பாரம்பரிய இந்திய ஜோதிட மரபை அடிப்படையாகக் கொண்டு, வாழ்க்கை, உறவுகள், தொழில் மற்றும் முக்கிய முடிவுகளுக்கான சிந்தனையுள்ள ஜோதிட வழிகாட்டலை நம்பகமான ஜோதிடர்கள் மற்றும் தனிப்பட்ட ஆலோசனை அனுபவத்துடன் வழங்குகிறோம்.','Traditional Wisdom':'பாரம்பரிய ஞானம்','Personal Guidance':'தனிப்பட்ட வழிகாட்டல்','Trusted Consultation':'நம்பகமான ஆலோசனை',
      'QUICK CONSULTATION':'விரைவு ஆலோசனை','Quick Consultation':'விரைவு ஆலோசனை','Ask Now':'இப்போது கேளுங்கள்','ASK NOW':'இப்போது கேளுங்கள்','Ask your astrology question':'உங்கள் ஜோதிடக் கேள்வியைக் கேளுங்கள்',
      'APPROVED ASTROLOGERS':'அங்கீகரிக்கப்பட்ட ஜோதிடர்கள்','Our Approved Astrologers':'எங்கள் அங்கீகரிக்கப்பட்ட ஜோதிடர்கள்','Choose an approved astrologer to view their profile and verified reviews.':'சுயவிவரம் மற்றும் சரிபார்க்கப்பட்ட மதிப்புரைகளைப் பார்க்க அங்கீகரிக்கப்பட்ட ஜோதிடரைத் தேர்ந்தெடுக்கவும்.','PROFILE & REVIEWS':'சுயவிவரம் & மதிப்புரைகள்','PROFILE LOADING...':'சுயவிவரம் ஏற்றப்படுகிறது...','Verified Reviews':'சரிபார்க்கப்பட்ட மதிப்புரைகள்','Loading reviews...':'மதிப்புரைகள் ஏற்றப்படுகின்றன...','No approved reviews for this astrologer yet.':'இந்த ஜோதிடருக்கு இன்னும் அங்கீகரிக்கப்பட்ட மதிப்புரைகள் இல்லை.','CLOSE':'மூடுக','TRY AGAIN':'மீண்டும் முயற்சிக்கவும்',
      'FREQUENTLY ASKED QUESTIONS':'அடிக்கடி கேட்கப்படும் கேள்விகள்','How do I ask an astrology question?':'ஜோதிடக் கேள்வியை எப்படி கேட்பது?','Login as a customer, choose Ask Your Questions, enter the birth details and question, then complete the secure payment flow.':'வாடிக்கையாளராக உள்நுழைந்து, உங்கள் கேள்விகளைத் தேர்வு செய்து, பிறப்பு விவரங்களையும் கேள்வியையும் உள்ளிட்டு பாதுகாப்பான கட்டணத்தை முடிக்கவும்.','Are astrologers verified?':'ஜோதிடர்கள் சரிபார்க்கப்பட்டவர்களா?','All astrologers are carefully reviewed and verified by SMV ASTRO before being approved for consultation services.':'அனைத்து ஜோதிடர்களும் ஆலோசனை சேவைக்கு அங்கீகரிக்கப்படுவதற்கு முன் SMV ASTRO மூலம் கவனமாக மதிப்பாய்வு செய்து சரிபார்க்கப்படுகிறார்கள்.','How can I contact SMV ASTRO?':'SMV ASTRO-வை எப்படி தொடர்பு கொள்வது?','Use the Contact Us form to send your query directly.':'உங்கள் கேள்வியை நேரடியாக அனுப்ப Contact Us படிவத்தைப் பயன்படுத்தவும்.','Do I need an account?':'கணக்கு அவசியமா?','An account is required for secure customer consultation features. You can create one from Customer Registration or the Login button.':'பாதுகாப்பான வாடிக்கையாளர் ஆலோசனை அம்சங்களுக்கு கணக்கு தேவை. Customer Registration அல்லது Login மூலம் கணக்கை உருவாக்கலாம்.','How are astrologers selected and verified?':'ஜோதிடர்கள் எவ்வாறு தேர்வு செய்யப்பட்டு சரிபார்க்கப்படுகிறார்கள்?','When will I receive my astrology answer?':'எனது ஜோதிடப் பதில் எப்போது கிடைக்கும்?','After successful payment and submission, your astrology question will normally be answered within 24 hours.':'கட்டணம் வெற்றிகரமாக முடிந்து கேள்வி சமர்ப்பிக்கப்பட்ட பிறகு, உங்கள் ஜோதிடக் கேள்விக்கு பொதுவாக 24 மணி நேரத்திற்குள் பதில் வழங்கப்படும்.','Is there a refund or cancellation policy?':'பணத்தைத் திரும்பப் பெறுதல் அல்லது ரத்து கொள்கை உள்ளதா?','Payments are generally non-refundable once an accepted question enters the consultation process. If SMV ASTRO cannot provide the purchased service, a refund may be considered.':'ஏற்றுக்கொள்ளப்பட்ட கேள்வி ஆலோசனை செயல்முறையில் சென்ற பிறகு கட்டணம் பொதுவாகத் திருப்பித் தரப்படாது. SMV ASTRO வாங்கிய சேவையை வழங்க முடியாவிட்டால், பணத்தைத் திருப்பித் தருவது பரிசீலிக்கப்படலாம்.','What happens if my question is not suitable for the astrology service?':'எனது கேள்வி ஜோதிட சேவைக்கு ஏற்றதாக இல்லாவிட்டால் என்ன ஆகும்?','Questions that are unrelated to astrology, inappropriate, abusive, or involve matters that SMV ASTRO cannot responsibly provide guidance on may be rejected. If the question is rejected before consultation is provided, the customer may be eligible for a refund, normally processed within 48 hours of the rejection decision.':'ஜோதிடத்துடன் தொடர்பில்லாத, பொருத்தமற்ற, அவமதிப்பான கேள்விகள் அல்லது SMV ASTRO பொறுப்புடன் வழிகாட்ட முடியாத விஷயங்கள் நிராகரிக்கப்படலாம். ஆலோசனை வழங்குவதற்கு முன் கேள்வி நிராகரிக்கப்பட்டால், வாடிக்கையாளர் பணத்தைத் திரும்பப் பெற தகுதியுடையவராக இருக்கலாம்; அது பொதுவாக நிராகரிப்பு முடிவிலிருந்து 48 மணி நேரத்திற்குள் செயல்படுத்தப்படும்.','Are astrology answers guaranteed?':'ஜோதிடப் பதில்கள் உறுதியானவையா?','No. Astrology is a traditional form of guidance and interpretation. It is not a guarantee of future events or outcomes. Customers are free to accept, consider, or disagree with the guidance provided.':'இல்லை. ஜோதிடம் பாரம்பரிய வழிகாட்டல் மற்றும் விளக்கத்தின் ஒரு வடிவமாகும். இது எதிர்கால நிகழ்வுகள் அல்லது முடிவுகளுக்கான உத்தரவாதம் அல்ல. வழங்கப்படும் வழிகாட்டலை ஏற்றுக்கொள்ளவும், பரிசீலிக்கவும் அல்லது ஏற்காமல் இருக்கவும் வாடிக்கையாளர்களுக்கு முழு சுதந்திரம் உள்ளது.',
      'Customer Dashboard':'வாடிக்கையாளர் டாஷ்போர்டு','Astrologer Dashboard':'ஜோதிடர் டாஷ்போர்டு','Admin Dashboard':'நிர்வாக டாஷ்போர்டு','My Dashboard':'என் டாஷ்போர்டு','Customer':'வாடிக்கையாளர்','ASTROLOGER':'ஜோதிடர்','My Questions':'என் கேள்விகள்','My Consultations':'என் ஆலோசனைகள்','Notifications':'அறிவிப்புகள்','Total Earnings':'மொத்த வருமானம்','Public Question Inbox':'பொது கேள்வி பெட்டி','Questions & Answers':'கேள்விகள் & பதில்கள்','Earnings Ledger':'வருமானப் பதிவு','Status':'நிலை','Approved profile':'அங்கீகரிக்கப்பட்ட சுயவிவரம்','Approved':'அங்கீகரிக்கப்பட்டது','Rejected':'நிராகரிக்கப்பட்டது','Waiting for Admin':'நிர்வாக அனுமதிக்காக காத்திருக்கிறது','Application Status':'விண்ணப்ப நிலை','Pending Admin Approval':'நிர்வாக அனுமதி நிலுவையில்','Waiting for Admin Approval':'நிர்வாக அனுமதிக்காக காத்திருக்கிறது','Refresh Status':'நிலையைப் புதுப்பிக்கவும்','REFRESH STATUS':'நிலையைப் புதுப்பிக்கவும்','Your customer/payment contact details remain private.':'உங்கள் வாடிக்கையாளர்/கட்டண தொடர்பு விவரங்கள் தனிப்பட்டதாக பாதுகாக்கப்படும்.','Change Payment Method':'கட்டண முறையை மாற்றவும்','active question(s)':'செயலில் உள்ள கேள்விகள்','Reach ₹300 to request a withdrawal.':'திரும்பப் பெற ₹300 அடைய வேண்டும்.','You can withdraw':'நீங்கள் தொகையைத் திரும்பப் பெறலாம்','WITHDRAW':'திரும்பப் பெறுக','Minimum withdrawal':'குறைந்தபட்ச திரும்பப் பெறும் தொகை','Commission is credited only after Admin approves the submitted answer.':'சமர்ப்பிக்கப்பட்ட பதிலை நிர்வாகம் அங்கீகரித்த பிறகே கமிஷன் வரவு வைக்கப்படும்.','No questions yet.':'இன்னும் கேள்விகள் இல்லை.','No paid public questions are available right now.':'தற்போது பணம் செலுத்தப்பட்ட பொது கேள்விகள் எதுவும் இல்லை.','CLAIM & ANSWER':'பெற்று பதிலளிக்கவும்','Submit for Admin Approval':'நிர்வாக அனுமதிக்குச் சமர்ப்பிக்கவும்','Resubmit for Admin Approval':'நிர்வாக அனுமதிக்காக மீண்டும் சமர்ப்பிக்கவும்','Birth details':'பிறப்பு விவரங்கள்','Question ID':'கேள்வி ID','Customer paid':'வாடிக்கையாளர் செலுத்தியது','Your commission':'உங்கள் கமிஷன்','Earnings Ledger':'வருமானப் பதிவு',
      'Customers':'வாடிக்கையாளர்கள்','Astrologers':'ஜோதிடர்கள்','Pending':'நிலுவையில்','Questions':'கேள்விகள்','Customer Reviews':'வாடிக்கையாளர் மதிப்புரைகள்','Pending Astrologers':'நிலுவையில் உள்ள ஜோதிடர்கள்','Admin Answers':'நிர்வாக பதில்கள்','Admin Reviews':'நிர்வாக மதிப்புரைகள்','Question Approval':'கேள்வி அனுமதி','Answer Approval':'பதில் அனுமதி','Approve':'அனுமதிக்கவும்','Reject':'நிராகரிக்கவும்','APPROVE & ALLOCATE':'அனுமதித்து ஒதுக்கவும்','REJECT QUESTION':'கேள்வியை நிராகரிக்கவும்','Save':'சேமிக்கவும்','SAVE':'சேமிக்கவும்','SAVING...':'சேமிக்கப்படுகிறது...','Test Razorpay Connection':'Razorpay இணைப்பைச் சோதிக்கவும்','TEST RAZORPAY CONNECTION':'Razorpay இணைப்பைச் சோதிக்கவும்','Commission Settings':'கமிஷன் அமைப்புகள்','Question Price':'கேள்வி கட்டணம்','Minimum Answer Words':'குறைந்தபட்ச பதில் சொற்கள்',
      'Email Login':'மின்னஞ்சல் உள்நுழைவு','Customer ID':'வாடிக்கையாளர் ID','Astrologer ID':'ஜோதிடர் ID','Email / ID':'மின்னஞ்சல் / ID','Email address':'மின்னஞ்சல் முகவரி','Password':'கடவுச்சொல்','Minimum 6 characters':'குறைந்தது 6 எழுத்துகள்','Forgot Password?':'கடவுச்சொல்லை மறந்துவிட்டீர்களா?','Create new customer account':'புதிய வாடிக்கையாளர் கணக்கை உருவாக்கவும்','Welcome Back':'மீண்டும் வரவேற்கிறோம்','Sign in to continue to your SMV ASTRO dashboard.':'SMV ASTRO டாஷ்போர்டைத் தொடர உள்நுழையவும்.','LOGIN':'உள்நுழைக','CREATE ACCOUNT':'கணக்கை உருவாக்கவும்','Create Account':'கணக்கை உருவாக்கவும்','Full Name':'முழு பெயர்','Mobile Number':'மொபைல் எண்','Email':'மின்னஞ்சல்','Register as Customer':'வாடிக்கையாளராக பதிவு செய்யவும்','Register as Astrologer':'ஜோதிடராக பதிவு செய்யவும்','Customer Registration':'வாடிக்கையாளர் பதிவு','Astrologer Registration':'ஜோதிடர் பதிவு','Choose Your Path':'உங்கள் பாதையைத் தேர்ந்தெடுக்கவும்','BEGIN YOUR JOURNEY WITH SMV ASTRO':'SMV ASTRO உடன் உங்கள் பயணத்தைத் தொடங்குங்கள்',
      'Payment Successful':'கட்டணம் வெற்றிகரமாக முடிந்தது','Payment Received':'கட்டணம் பெறப்பட்டது','Question Approved':'கேள்வி அங்கீகரிக்கப்பட்டது','Astrologer Answer Submitted':'ஜோதிடர் பதில் சமர்ப்பிக்கப்பட்டது','Admin Approval':'நிர்வாக அனுமதி','Answer Ready':'பதில் தயாராக உள்ளது','Astrologer Answer':'ஜோதிடர் பதில்','Your Question':'உங்கள் கேள்வி','Ask Your Question':'உங்கள் ஜோதிடக் கேள்வியைக் கேளுங்கள்','Proceed to Secure Payment':'பாதுகாப்பான கட்டணத்திற்குத் தொடர்க','24 hours':'24 மணி நேரம்','48 hours':'48 மணி நேரம்','within 24 hours':'24 மணி நேரத்திற்குள்','within 48 hours':'48 மணி நேரத்திற்குள்'
    };
    const H={
      'Home':'होम','Contact':'संपर्क','Dashboard':'डैशबोर्ड','Admin':'एडमिन','Login':'लॉगिन','Logout':'लॉगआउट','Register':'पंजीकरण','Close':'बंद करें','Back':'वापस','← Back':'← वापस','← Back to Home':'← होम पर वापस जाएँ','FAQ':'अक्सर पूछे जाने वाले प्रश्न',
      'ASTROLOGY CONSULTATION':'ज्योतिष परामर्श','VEDA • JYOTISHA • GUIDANCE':'वेद • ज्योतिष • मार्गदर्शन','WELCOME TO SMV ASTRO SERVICES':'SMV ASTRO सेवाओं में आपका स्वागत है','Trusted Astrological Guidance for a Better Tomorrow':'बेहतर कल के लिए विश्वसनीय ज्योतिषीय मार्गदर्शन','Rooted in the time-honoured Indian tradition of Jyotisha, we bring thoughtful astrological guidance for life, relationships, career and important decisions — with trusted astrologers and a private consultation experience.':'प्राचीन भारतीय ज्योतिष परंपरा पर आधारित, हम जीवन, संबंधों, करियर और महत्वपूर्ण निर्णयों के लिए विश्वसनीय ज्योतिषियों के साथ व्यक्तिगत और विचारपूर्ण ज्योतिषीय मार्गदर्शन प्रदान करते हैं।','Traditional Wisdom':'पारंपरिक ज्ञान','Personal Guidance':'व्यक्तिगत मार्गदर्शन','Trusted Consultation':'विश्वसनीय परामर्श',
      'QUICK CONSULTATION':'त्वरित परामर्श','Quick Consultation':'त्वरित परामर्श','Ask Now':'अभी पूछें','ASK NOW':'अभी पूछें','Ask your astrology question':'अपना ज्योतिषीय प्रश्न पूछें','APPROVED ASTROLOGERS':'स्वीकृत ज्योतिषी','Our Approved Astrologers':'हमारे स्वीकृत ज्योतिषी','Choose an approved astrologer to view their profile and verified reviews.':'प्रोफ़ाइल और सत्यापित समीक्षाएँ देखने के लिए स्वीकृत ज्योतिषी चुनें।','PROFILE & REVIEWS':'प्रोफ़ाइल और समीक्षाएँ','PROFILE LOADING...':'प्रोफ़ाइल लोड हो रही है...','Verified Reviews':'सत्यापित समीक्षाएँ','Loading reviews...':'समीक्षाएँ लोड हो रही हैं...','No approved reviews for this astrologer yet.':'इस ज्योतिषी के लिए अभी कोई स्वीकृत समीक्षा नहीं है।','CLOSE':'बंद करें','TRY AGAIN':'फिर से प्रयास करें',
      'FREQUENTLY ASKED QUESTIONS':'अक्सर पूछे जाने वाले प्रश्न','How do I ask an astrology question?':'मैं ज्योतिष का प्रश्न कैसे पूछूँ?','Login as a customer, choose Ask Your Questions, enter the birth details and question, then complete the secure payment flow.':'ग्राहक के रूप में लॉगिन करें, अपने प्रश्न चुनें, जन्म विवरण और प्रश्न दर्ज करें, फिर सुरक्षित भुगतान पूरा करें।','Are astrologers verified?':'क्या ज्योतिषी सत्यापित हैं?','All astrologers are carefully reviewed and verified by SMV ASTRO before being approved for consultation services.':'सभी ज्योतिषियों की परामर्श सेवा के लिए स्वीकृति से पहले SMV ASTRO द्वारा सावधानीपूर्वक समीक्षा और सत्यापन किया जाता है।','How can I contact SMV ASTRO?':'मैं SMV ASTRO से कैसे संपर्क करूँ?','Use the Contact Us form to send your query directly.':'अपना प्रश्न सीधे भेजने के लिए Contact Us फ़ॉर्म का उपयोग करें।','Do I need an account?':'क्या खाता आवश्यक है?','An account is required for secure customer consultation features. You can create one from Customer Registration or the Login button.':'सुरक्षित ग्राहक परामर्श सुविधाओं के लिए खाता आवश्यक है। आप Customer Registration या Login से खाता बना सकते हैं।','How are astrologers selected and verified?':'ज्योतिषियों का चयन और सत्यापन कैसे किया जाता है?','When will I receive my astrology answer?':'मुझे अपने ज्योतिषीय प्रश्न का उत्तर कब मिलेगा?','After successful payment and submission, your astrology question will normally be answered within 24 hours.':'सफल भुगतान और प्रश्न जमा करने के बाद आपके ज्योतिषीय प्रश्न का उत्तर सामान्यतः 24 घंटे के भीतर दिया जाएगा।','Is there a refund or cancellation policy?':'क्या रिफंड या रद्दीकरण नीति है?','Payments are generally non-refundable once an accepted question enters the consultation process. If SMV ASTRO cannot provide the purchased service, a refund may be considered.':'स्वीकृत प्रश्न के परामर्श प्रक्रिया में जाने के बाद भुगतान सामान्यतः वापस नहीं किया जाता। यदि SMV ASTRO खरीदी गई सेवा प्रदान नहीं कर सकता, तो रिफंड पर विचार किया जा सकता है।','What happens if my question is not suitable for the astrology service?':'यदि मेरा प्रश्न ज्योतिष सेवा के लिए उपयुक्त नहीं है तो क्या होगा?','Questions that are unrelated to astrology, inappropriate, abusive, or involve matters that SMV ASTRO cannot responsibly provide guidance on may be rejected. If the question is rejected before consultation is provided, the customer may be eligible for a refund, normally processed within 48 hours of the rejection decision.':'ज्योतिष से असंबंधित, अनुचित, अपमानजनक प्रश्न या ऐसे विषय जिन पर SMV ASTRO जिम्मेदारी से मार्गदर्शन नहीं दे सकता, अस्वीकार किए जा सकते हैं। यदि परामर्श देने से पहले प्रश्न अस्वीकार किया जाता है, तो ग्राहक रिफंड के लिए पात्र हो सकता है और यह सामान्यतः 48 घंटे के भीतर संसाधित किया जाएगा।','Are astrology answers guaranteed?':'क्या ज्योतिषीय उत्तर निश्चित होते हैं?','No. Astrology is a traditional form of guidance and interpretation. It is not a guarantee of future events or outcomes. Customers are free to accept, consider, or disagree with the guidance provided.':'नहीं। ज्योतिष पारंपरिक मार्गदर्शन और व्याख्या का एक रूप है। यह भविष्य की घटनाओं या परिणामों की गारंटी नहीं है। ग्राहक दिए गए मार्गदर्शन को स्वीकार, विचार या असहमत कर सकते हैं।',
      'Customer Dashboard':'ग्राहक डैशबोर्ड','Astrologer Dashboard':'ज्योतिषी डैशबोर्ड','Admin Dashboard':'एडमिन डैशबोर्ड','My Dashboard':'मेरा डैशबोर्ड','Customer':'ग्राहक','ASTROLOGER':'ज्योतिषी','My Questions':'मेरे प्रश्न','My Consultations':'मेरे परामर्श','Notifications':'सूचनाएँ','Total Earnings':'कुल कमाई','Public Question Inbox':'सार्वजनिक प्रश्न इनबॉक्स','Questions & Answers':'प्रश्न और उत्तर','Earnings Ledger':'कमाई विवरण','Status':'स्थिति','Approved profile':'स्वीकृत प्रोफ़ाइल','Approved':'स्वीकृत','Rejected':'अस्वीकृत','Waiting for Admin':'एडमिन की प्रतीक्षा','Application Status':'आवेदन स्थिति','Pending Admin Approval':'एडमिन स्वीकृति लंबित','Waiting for Admin Approval':'एडमिन स्वीकृति की प्रतीक्षा','REFRESH STATUS':'स्थिति अपडेट करें','Your customer/payment contact details remain private.':'आपके ग्राहक/भुगतान संपर्क विवरण निजी रखे जाते हैं।','Change Payment Method':'भुगतान विधि बदलें','active question(s)':'सक्रिय प्रश्न','Reach ₹300 to request a withdrawal.':'निकासी का अनुरोध करने के लिए ₹300 तक पहुँचें।','You can withdraw':'आप निकासी कर सकते हैं','WITHDRAW':'निकासी करें','Minimum withdrawal':'न्यूनतम निकासी','Commission is credited only after Admin approves the submitted answer.':'जमा किए गए उत्तर को एडमिन द्वारा स्वीकृत करने के बाद ही कमीशन जमा किया जाता है।','No questions yet.':'अभी कोई प्रश्न नहीं है।','No paid public questions are available right now.':'अभी कोई भुगतान किए गए सार्वजनिक प्रश्न उपलब्ध नहीं हैं।','CLAIM & ANSWER':'प्राप्त करें और उत्तर दें','Submit for Admin Approval':'एडमिन स्वीकृति के लिए जमा करें','Resubmit for Admin Approval':'एडमिन स्वीकृति के लिए फिर जमा करें','Birth details':'जन्म विवरण','Question ID':'प्रश्न ID','Customer paid':'ग्राहक द्वारा भुगतान','Your commission':'आपका कमीशन',
      'Customers':'ग्राहक','Astrologers':'ज्योतिषी','Pending':'लंबित','Questions':'प्रश्न','Customer Reviews':'ग्राहक समीक्षाएँ','Pending Astrologers':'लंबित ज्योतिषी','Admin Answers':'एडमिन उत्तर','Admin Reviews':'एडमिन समीक्षाएँ','Question Approval':'प्रश्न स्वीकृति','Answer Approval':'उत्तर स्वीकृति','Approve':'स्वीकृत करें','Reject':'अस्वीकार करें','APPROVE & ALLOCATE':'स्वीकृत करके आवंटित करें','REJECT QUESTION':'प्रश्न अस्वीकार करें','Save':'सहेजें','SAVE':'सहेजें','SAVING...':'सहेजा जा रहा है...','TEST RAZORPAY CONNECTION':'Razorpay कनेक्शन जाँचें','Commission Settings':'कमीशन सेटिंग्स','Question Price':'प्रश्न मूल्य','Minimum Answer Words':'न्यूनतम उत्तर शब्द',
      'Email Login':'ईमेल लॉगिन','Customer ID':'ग्राहक ID','Astrologer ID':'ज्योतिषी ID','Email / ID':'ईमेल / ID','Email address':'ईमेल पता','Password':'पासवर्ड','Minimum 6 characters':'कम से कम 6 अक्षर','Forgot Password?':'पासवर्ड भूल गए?','Create new customer account':'नया ग्राहक खाता बनाएँ','Welcome Back':'वापसी पर स्वागत है','Sign in to continue to your SMV ASTRO dashboard.':'अपने SMV ASTRO डैशबोर्ड पर जाने के लिए लॉगिन करें।','Secure authentication powered by Firebase.':'Firebase द्वारा सुरक्षित प्रमाणीकरण।','LOGIN':'लॉगिन','CREATE ACCOUNT':'खाता बनाएँ','Create Account':'खाता बनाएँ','Full Name':'पूरा नाम','Mobile Number':'मोबाइल नंबर','Email':'ईमेल','Register as Customer':'ग्राहक के रूप में पंजीकरण करें','Register as Astrologer':'ज्योतिषी के रूप में पंजीकरण करें','Customer Registration':'ग्राहक पंजीकरण','Astrologer Registration':'ज्योतिषी पंजीकरण','Choose Your Path':'अपना मार्ग चुनें','BEGIN YOUR JOURNEY WITH SMV ASTRO':'SMV ASTRO के साथ अपनी यात्रा शुरू करें',
      'Payment Successful':'भुगतान सफल','Payment Received':'भुगतान प्राप्त','Question Approved':'प्रश्न स्वीकृत','Astrologer Answer Submitted':'ज्योतिषी का उत्तर जमा किया गया','Admin Approval':'एडमिन स्वीकृति','Answer Ready':'उत्तर तैयार','Astrologer Answer':'ज्योतिषी का उत्तर','Your Question':'आपका प्रश्न','Ask Your Question':'अपना ज्योतिषीय प्रश्न पूछें','Proceed to Secure Payment':'सुरक्षित भुगतान के लिए आगे बढ़ें','24 hours':'24 घंटे','48 hours':'48 घंटे','within 24 hours':'24 घंटे के भीतर','within 48 hours':'48 घंटे के भीतर'
    };
    const UI_T={
      'Profile':'சுயவிவரம்','My Questions':'என் கேள்விகள்','Total Earnings':'மொத்த வருமானம்','Public Question Inbox':'பொது கேள்வி பெட்டி','Questions & Answers':'கேள்விகள் மற்றும் பதில்கள்','Earnings Ledger':'வருமானப் பதிவு','Payment Method':'கட்டண முறை','Change Payment Method':'கட்டண முறையை மாற்றவும்','Status':'நிலை','Application Status':'விண்ணப்ப நிலை','Approved profile':'அங்கீகரிக்கப்பட்ட சுயவிவரம்','Waiting for Admin':'நிர்வாக அனுமதிக்காக காத்திருக்கிறது','Pending Admin Approval':'நிர்வாக அனுமதி நிலுவையில்','Your Question':'உங்கள் கேள்வி','Ask Your Question':'உங்கள் ஜோதிடக் கேள்வியைக் கேளுங்கள்','Birth Details':'பிறப்பு விவரங்கள்','Question ID':'கேள்வி ID','Customer paid':'வாடிக்கையாளர் செலுத்தியது','Your commission':'உங்கள் கமிஷன்','Available to Withdraw':'திரும்பப் பெறக்கூடிய தொகை','Minimum withdrawal':'குறைந்தபட்ச திரும்பப் பெறும் தொகை','Commission':'கமிஷன்','Credited':'வரவு வைக்கப்பட்டது','Consultation':'ஆலோசனை','Question':'கேள்வி','Answer':'பதில்','Answer Ready':'பதில் தயாராக உள்ளது','Payment Received':'கட்டணம் பெறப்பட்டது','Question Approved':'கேள்வி அங்கீகரிக்கப்பட்டது','Astrologer Answer Submitted':'ஜோதிடர் பதில் சமர்ப்பிக்கப்பட்டது','Admin Approval':'நிர்வாக அங்கீகாரம்','Notifications':'அறிவிப்புகள்','My Consultations':'என் ஆலோசனைகள்','Email verification':'மின்னஞ்சல் சரிபார்ப்பு','Verified':'சரிபார்க்கப்பட்டது','Private':'தனிப்பட்டது','years experience':'ஆண்டுகள் அனுபவம்','Expertise':'நிபுணத்துவம்','PROFILE & REVIEWS':'சுயவிவரம் & மதிப்புரைகள்','Verified Reviews':'சரிபார்க்கப்பட்ட மதிப்புரைகள்','Loading reviews...':'மதிப்புரைகள் ஏற்றப்படுகின்றன...','No approved reviews for this astrologer yet.':'இந்த ஜோதிடருக்கு இன்னும் அங்கீகரிக்கப்பட்ட மதிப்புரைகள் இல்லை.','Astrologer Dashboard':'ஜோதிடர் டாஷ்போர்டு','Customer Dashboard':'வாடிக்கையாளர் டாஷ்போர்டு','Admin Dashboard':'நிர்வாக டாஷ்போர்டு','Customers':'வாடிக்கையாளர்கள்','Astrologers':'ஜோதிடர்கள்','Pending':'நிலுவையில்','Questions':'கேள்விகள்','Customer Reviews':'வாடிக்கையாளர் மதிப்புரைகள்','Pending Astrologers':'நிலுவையில் உள்ள ஜோதிடர்கள்','Admin Answers':'நிர்வாக பதில்கள்','Admin Reviews':'நிர்வாக மதிப்புரைகள்','Question Approval':'கேள்வி அங்கீகாரம்','Answer Approval':'பதில் அங்கீகாரம்','Approve':'அங்கீகரிக்கவும்','Reject':'நிராகரிக்கவும்','SAVE':'சேமிக்கவும்','WITHDRAW':'திரும்பப் பெறுக','CLAIM & ANSWER':'பெற்று பதிலளிக்கவும்','Submit for Admin Approval':'நிர்வாக அங்கீகாரத்திற்கு சமர்ப்பிக்கவும்','Resubmit for Admin Approval':'நிர்வாக அங்கீகாரத்திற்கு மீண்டும் சமர்ப்பிக்கவும்','Proceed to Secure Payment':'பாதுகாப்பான கட்டணத்திற்குத் தொடர்க','Forgot Password?':'கடவுச்சொல்லை மறந்துவிட்டீர்களா?','Create new customer account':'புதிய வாடிக்கையாளர் கணக்கை உருவாக்கவும்','Email Login':'மின்னஞ்சல் உள்நுழைவு','Customer ID':'வாடிக்கையாளர் ID','Astrologer ID':'ஜோதிடர் ID','Email / ID':'மின்னஞ்சல் / ID','Email address':'மின்னஞ்சல் முகவரி','Password':'கடவுச்சொல்','LOGIN':'உள்நுழைக','CREATE ACCOUNT':'கணக்கை உருவாக்குக','Register':'பதிவு','Logout':'வெளியேறு','Login':'உள்நுழைவு','Close':'மூடு','Back':'பின்','Home':'முகப்பு','Contact':'தொடர்பு','Dashboard':'டாஷ்போர்டு'};
    const UI_H={
      'Profile':'प्रोफ़ाइल','My Questions':'मेरे प्रश्न','Total Earnings':'कुल कमाई','Public Question Inbox':'सार्वजनिक प्रश्न इनबॉक्स','Questions & Answers':'प्रश्न और उत्तर','Earnings Ledger':'कमाई विवरण','Payment Method':'भुगतान विधि','Change Payment Method':'भुगतान विधि बदलें','Status':'स्थिति','Application Status':'आवेदन स्थिति','Approved profile':'स्वीकृत प्रोफ़ाइल','Waiting for Admin':'एडमिन की प्रतीक्षा','Pending Admin Approval':'एडमिन स्वीकृति लंबित','Your Question':'आपका प्रश्न','Ask Your Question':'अपना ज्योतिषीय प्रश्न पूछें','Birth Details':'जन्म विवरण','Question ID':'प्रश्न ID','Customer paid':'ग्राहक द्वारा भुगतान','Your commission':'आपका कमीशन','Available to Withdraw':'निकासी के लिए उपलब्ध','Minimum withdrawal':'न्यूनतम निकासी','Commission':'कमीशन','Credited':'जमा किया गया','Consultation':'परामर्श','Question':'प्रश्न','Answer':'उत्तर','Answer Ready':'उत्तर तैयार','Payment Received':'भुगतान प्राप्त','Question Approved':'प्रश्न स्वीकृत','Astrologer Answer Submitted':'ज्योतिषी का उत्तर जमा किया गया','Admin Approval':'एडमिन स्वीकृति','Notifications':'सूचनाएँ','My Consultations':'मेरे परामर्श','Email verification':'ईमेल सत्यापन','Verified':'सत्यापित','Private':'निजी','years experience':'वर्षों का अनुभव','Expertise':'विशेषज्ञता','PROFILE & REVIEWS':'प्रोफ़ाइल और समीक्षाएँ','Verified Reviews':'सत्यापित समीक्षाएँ','Loading reviews...':'समीक्षाएँ लोड हो रही हैं...','No approved reviews for this astrologer yet.':'इस ज्योतिषी के लिए अभी कोई स्वीकृत समीक्षा नहीं है।','Astrologer Dashboard':'ज्योतिषी डैशबोर्ड','Customer Dashboard':'ग्राहक डैशबोर्ड','Admin Dashboard':'एडमिन डैशबोर्ड','Customers':'ग्राहक','Astrologers':'ज्योतिषी','Pending':'लंबित','Questions':'प्रश्न','Customer Reviews':'ग्राहक समीक्षाएँ','Pending Astrologers':'लंबित ज्योतिषी','Admin Answers':'एडमिन उत्तर','Admin Reviews':'एडमिन समीक्षाएँ','Question Approval':'प्रश्न स्वीकृति','Answer Approval':'उत्तर स्वीकृति','Approve':'स्वीकृत करें','Reject':'अस्वीकार करें','SAVE':'सहेजें','WITHDRAW':'निकासी करें','CLAIM & ANSWER':'प्राप्त करें और उत्तर दें','Submit for Admin Approval':'एडमिन स्वीकृति के लिए जमा करें','Resubmit for Admin Approval':'एडमिन स्वीकृति के लिए फिर जमा करें','Proceed to Secure Payment':'सुरक्षित भुगतान के लिए आगे बढ़ें','Forgot Password?':'पासवर्ड भूल गए?','Create new customer account':'नया ग्राहक खाता बनाएँ','Email Login':'ईमेल लॉगिन','Customer ID':'ग्राहक ID','Astrologer ID':'ज्योतिषी ID','Email / ID':'ईमेल / ID','Email address':'ईमेल पता','Password':'पासवर्ड','LOGIN':'लॉगिन','CREATE ACCOUNT':'खाता बनाएँ','Register':'पंजीकरण','Logout':'लॉगआउट','Login':'लॉगिन','Close':'बंद करें','Back':'वापस','Home':'होम','Contact':'संपर्क','Dashboard':'डैशबोर्ड'};
    /* SMV ASTRO multilingual completion layer.
       Adds missing visible UI, form, status, dialog and dynamic messages.
       No Firebase/payment/auth/business logic is changed. */
    const EXTRA_T={"After successful payment and submission, your astrology question will normally be answered within":"கட்டணம் வெற்றிகரமாக முடிந்து கேள்வி சமர்ப்பிக்கப்பட்ட பிறகு, உங்கள் ஜோதிடக் கேள்விக்கு பொதுவாக","Answer Word Limit":"பதில் சொல் வரம்பு","Answers Awaiting Approval":"அனுமதிக்காக காத்திருக்கும் பதில்கள்","Apply to become an SMV ASTRO astrologer. Your professional profile will be reviewed before it becomes public.":"SMV ASTRO ஜோதிடராக விண்ணப்பிக்கவும். உங்கள் தொழில்முறை சுயவிவரம் பொதுவில் வெளியிடப்படுவதற்கு முன் மதிப்பாய்வு செய்யப்படும்.","Astrologer Applications":"ஜோதிடர் விண்ணப்பங்கள்","Astrologer Withdrawals":"ஜோதிடர் தொகைத் திரும்பப் பெறுதல்","Bank/UPI details are private and visible only to Admin. They will not be shown again in full to the Astrologer.":"வங்கி/UPI விவரங்கள் தனிப்பட்டவை; நிர்வாகிக்கு மட்டும் தெரியும். அவை மீண்டும் ஜோதிடருக்கு முழுமையாகக் காட்டப்படாது.","CONTINUE TO DASHBOARD":"டாஷ்போர்டுக்குத் தொடர்க","Contact Us":"எங்களைத் தொடர்பு கொள்ளுங்கள்","Create your private customer account to access the secure consultation area and choose an approved astrologer.":"பாதுகாப்பான ஆலோசனைப் பகுதிக்குள் சென்று அங்கீகரிக்கப்பட்ட ஜோதிடரைத் தேர்வு செய்ய உங்கள் தனிப்பட்ட வாடிக்கையாளர் கணக்கை உருவாக்குங்கள்.","Date of Birth":"பிறந்த தேதி","Email *":"மின்னஞ்சல் *","Enter the birth details of the person for whom you are asking the question.":"நீங்கள் கேள்வி கேட்கும் நபரின் பிறப்பு விவரங்களை உள்ளிடவும்.","Female":"பெண்","Gender (Optional)":"பாலினம் (விருப்பம்)","Have a question? Send us your details and query. Our admin team will contact you soon.":"கேள்வி உள்ளதா? உங்கள் விவரங்களையும் கேள்வியையும் அனுப்புங்கள். எங்கள் நிர்வாகக் குழு விரைவில் உங்களைத் தொடர்புகொள்ளும்.","Loading answers...":"பதில்கள் ஏற்றப்படுகின்றன...","Loading applications...":"விண்ணப்பங்கள் ஏற்றப்படுகின்றன...","Loading approved astrologers...":"அங்கீகரிக்கப்பட்ட ஜோதிடர்கள் ஏற்றப்படுகின்றனர்...","Loading current question price...":"தற்போதைய கேள்விக் கட்டணம் ஏற்றப்படுகிறது...","Loading questions...":"கேள்விகள் ஏற்றப்படுகின்றன...","Loading withdrawal requests...":"தொகைத் திரும்பப் பெறும் கோரிக்கைகள் ஏற்றப்படுகின்றன...","Male":"ஆண்","Mobile Number *":"மொபைல் எண் *","Name":"பெயர்","Name *":"பெயர் *","Other":"மற்றவை","Payment Method":"கட்டண முறை","Payment Successful ✓":"கட்டணம் வெற்றிகரமாக முடிந்தது ✓","Place / City *":"இடம் / நகரம் *","Place of Birth":"பிறந்த இடம்","Prefer not to say":"கூற விரும்பவில்லை","Profile Photo":"சுயவிவரப் படம்","Public Question Approval":"பொது கேள்வி அனுமதி","Query *":"கேள்வி *","Recent Questions":"சமீபத்திய கேள்விகள்","Register according to your purpose. Customer and Astrologer accounts are kept separate, with each journey designed for its own needs.":"உங்கள் தேவைக்கேற்ப பதிவு செய்யுங்கள். வாடிக்கையாளர் மற்றும் ஜோதிடர் கணக்குகள் தனித்தனியாக வைக்கப்பட்டுள்ளன; ஒவ்வொரு பயணமும் அதன் தேவைக்கேற்ப வடிவமைக்கப்பட்டுள்ளது.","Register as Astrologer":"ஜோதிடராக பதிவு செய்யவும்","Register as Customer":"வாடிக்கையாளராக பதிவு செய்யவும்","SAVE COMMISSION":"கமிஷனைச் சேமிக்கவும்","SAVE PRICE":"கட்டணத்தைச் சேமிக்கவும்","SAVE WORD LIMIT":"சொல் வரம்பைச் சேமிக்கவும்","SEND QUERY":"கேள்வியை அனுப்பவும்","SMV ASTRO administration and approval center":"SMV ASTRO நிர்வாக மற்றும் அனுமதி மையம்","SUBMIT REGISTRATION":"பதிவைச் சமர்ப்பிக்கவும்","Time of Birth":"பிறந்த நேரம்","Your payment has been securely verified.":"உங்கள் கட்டணம் பாதுகாப்பாகச் சரிபார்க்கப்பட்டது.","Your profile will remain pending until SMV ASTRO approves it.":"SMV ASTRO அங்கீகரிக்கும் வரை உங்கள் சுயவிவரம் நிலுவையில் இருக்கும்.","of the rejection decision.":"நிராகரிப்பு முடிவிலிருந்து","← Home":"← முகப்பு","Bank Name":"வங்கி பெயர்","Full name":"முழுப் பெயர்","MARK PAID":"பணம் செலுத்தப்பட்டது எனக் குறிக்கவும்","Your name":"உங்கள் பெயர்","Your place":"உங்கள் இடம்","SAVE CHANGES":"மாற்றங்களைச் சேமிக்கவும்","Admin Answer":"நிர்வாக பதில்","Logout failed":"வெளியேற முடியவில்லை","REJECT ANSWER":"பதிலை நிராகரிக்கவும்","REJECT REVIEW":"மதிப்புரையை நிராகரிக்கவும்","RETRY PAYMENT":"கட்டணத்தை மீண்டும் முயற்சிக்கவும்","Submit Review":"மதிப்புரையைச் சமர்ப்பிக்கவும்","APPROVE ANSWER":"பதிலை அங்கீகரிக்கவும்","Review Deleted":"மதிப்புரை நீக்கப்பட்டது","Your full name":"உங்கள் முழுப் பெயர்","Answer Approved":"பதில் அங்கீகரிக்கப்பட்டது","Customer review":"வாடிக்கையாளர் மதிப்புரை","MARK PROCESSING":"செயலாக்கம் எனக் குறிக்கவும்","Withdrawal paid":"தொகை வழங்கப்பட்டது","Answer Submitted":"பதில் சமர்ப்பிக்கப்பட்டது","No answer found.":"பதில் எதுவும் இல்லை.","Unable to Submit":"சமர்ப்பிக்க முடியவில்லை","Please try again.":"மீண்டும் முயற்சிக்கவும்.","Review not found.":"மதிப்புரை கிடைக்கவில்லை.","SAVING PROFILE...":"சுயவிவரம் சேமிக்கப்படுகிறது...","Verified Customer":"சரிபார்க்கப்பட்ட வாடிக்கையாளர்","Write your review":"உங்கள் மதிப்புரையை எழுதுங்கள்","REQUEST WITHDRAWAL":"தொகைத் திரும்பப் பெற கோரிக்கை","Your mobile number":"உங்கள் மொபைல் எண்","Account Holder Name":"கணக்கு வைத்திருப்பவர் பெயர்","CREATING PAYMENT...":"கட்டணம் உருவாக்கப்படுகிறது...","Please login again.":"மீண்டும் உள்நுழையவும்.","Question not found.":"கேள்வி கிடைக்கவில்லை.","REQUEST APPOINTMENT":"முன்பதிவு கோரிக்கை","Withdrawal rejected":"தொகைத் திரும்பப் பெறுதல் நிராகரிக்கப்பட்டது","OPENING DASHBOARD...":"டாஷ்போர்டு திறக்கப்படுகிறது...","Available to Withdraw":"திரும்பப் பெறக் கிடைக்கும் தொகை","Enter a valid amount.":"சரியான தொகையை உள்ளிடவும்.","New Question Assigned":"புதிய கேள்வி ஒதுக்கப்பட்டுள்ளது","Profile lookup failed":"சுயவிவரத்தைப் பெற முடியவில்லை","Question Not Approved":"கேள்வி அங்கீகரிக்கப்படவில்லை","Please login as Admin.":"நிர்வாகியாக உள்நுழையவும்.","Enter rejection reason.":"நிராகரிப்பு காரணத்தை உள்ளிடவும்.","Invalid question price.":"கேள்விக் கட்டணம் தவறானது.","Please enter your name.":"உங்கள் பெயரை உள்ளிடவும்.","Please write an answer.":"ஒரு பதிலை எழுதவும்.","SMV ASTRO payment error":"SMV ASTRO கட்டணப் பிழை","Unable to Reject Review":"மதிப்புரையை நிராகரிக்க முடியவில்லை","Answer requires revision":"பதிலில் திருத்தம் தேவை","Review submission error:":"மதிப்புரை சமர்ப்பிப்பு பிழை:","Unable to edit question.":"கேள்வியைத் திருத்த முடியவில்லை.","Verified customer review":"சரிபார்க்கப்பட்ட வாடிக்கையாளர் மதிப்புரை","Withdrawal is processing":"தொகைத் திரும்பப் பெறுதல் செயலாக்கத்தில் உள்ளது","Write your query here...":"உங்கள் கேள்வியை இங்கே எழுதுங்கள்...","Appointment update error:":"முன்பதிவு புதுப்பிப்பு பிழை:","Pending from registration":"பதிவிலிருந்து நிலுவையில்","Please write your review.":"உங்கள் மதிப்புரையை எழுதவும்.","Public Astrology Question":"பொது ஜோதிடக் கேள்வி","Withdrawal request error:":"தொகைத் திரும்பப் பெறும் கோரிக்கை பிழை:","Appointment booking error:":"முன்பதிவு பிழை:","Profile photo is required.":"சுயவிவரப் படம் அவசியம்.","Astrologer is not assigned.":"ஜோதிடர் ஒதுக்கப்படவில்லை.","Earnings calculation error:":"வருமானக் கணக்கீட்டுப் பிழை:","Please select Chat or Call.":"Chat அல்லது Call-ஐத் தேர்வு செய்யவும்.","Incorrect email or password.":"மின்னஞ்சல் அல்லது கடவுச்சொல் தவறாக உள்ளது.","New customer? Create account":"புதிய வாடிக்கையாளரா? கணக்கை உருவாக்கவும்","Payment verification failed.":"கட்டணச் சரிபார்ப்பு தோல்வியடைந்தது.","Please login before booking.":"முன்பதிவு செய்வதற்கு முன் உள்நுழையவும்.","Unable to save Admin answer.":"நிர்வாக பதிலைச் சேமிக்க முடியவில்லை.","Customer Login Required":"வாடிக்கையாளர் உள்நுழைவு அவசியம்","Dashboard retry failed:":"டாஷ்போர்டை மீண்டும் ஏற்ற முடியவில்லை:","Please select your preferred date.":"விருப்பமான தேதியைத் தேர்வு செய்யவும்.","Please select your preferred time.":"விருப்பமான நேரத்தைத் தேர்வு செய்யவும்.","Please select a rating from 1 to 5.":"1 முதல் 5 வரை மதிப்பீட்டைத் தேர்வு செய்யவும்.","Select another approved astrologer.":"மற்றொரு அங்கீகரிக்கப்பட்ட ஜோதிடரைத் தேர்வு செய்யவும்.","Create your secure customer account.":"உங்கள் பாதுகாப்பான வாடிக்கையாளர் கணக்கை உருவாக்குங்கள்.","Enter a valid commission percentage.":"சரியான கமிஷன் சதவீதத்தை உள்ளிடவும்.","This question is no longer available.":"இந்தக் கேள்வி இனி கிடைக்கவில்லை.","This question is not assigned to you.":"இந்தக் கேள்வி உங்களுக்கு ஒதுக்கப்படவில்லை.","Write your astrology question here...":"உங்கள் ஜோதிடக் கேள்வியை இங்கே எழுதுங்கள்...","Astrologer information does not match.":"ஜோதிடர் தகவல் பொருந்தவில்லை.","Question Re-assigned by Admin":"கேள்வி நிர்வாகியால் மீண்டும் ஒதுக்கப்பட்டது","Question updated successfully.":"கேள்வி வெற்றிகரமாகப் புதுப்பிக்கப்பட்டது.","Admin data could not be loaded.":"நிர்வாகத் தரவை ஏற்ற முடியவில்லை.","Unable to re-allocate question.":"கேள்வியை மீண்டும் ஒதுக்க முடியவில்லை.","Please enter the Admin answer.":"நிர்வாக பதிலை உள்ளிடவும்.","Profile dialog is unavailable.":"சுயவிவர சாளரம் கிடைக்கவில்லை.","Question price is not configured.":"கேள்விக் கட்டணம் அமைக்கப்படவில்லை.","Please enter your mobile number.":"உங்கள் மொபைல் எண்ணை உள்ளிடவும்.","This action could not be opened.":"இந்த செயலியைத் திறக்க முடியவில்லை.","This is not a valid Customer ID.":"இது சரியான வாடிக்கையாளர் ID அல்ல.","Approved astrologers load failed:":"அங்கீகரிக்கப்பட்ட ஜோதிடர்களை ஏற்ற முடியவில்லை:","Question approved and allocated to ":"கேள்வி அங்கீகரிக்கப்பட்டு ஒதுக்கப்பட்டது: ","Question email notification failed:":"கேள்வி மின்னஞ்சல் அறிவிப்பு தோல்வியடைந்தது:","Language":"மொழி"};
    const EXTRA_H={"After successful payment and submission, your astrology question will normally be answered within":"सफल भुगतान और प्रश्न जमा करने के बाद आपके ज्योतिषीय प्रश्न का उत्तर सामान्यतः","Answer Word Limit":"उत्तर शब्द सीमा","Answers Awaiting Approval":"स्वीकृति की प्रतीक्षा में उत्तर","Apply to become an SMV ASTRO astrologer. Your professional profile will be reviewed before it becomes public.":"SMV ASTRO ज्योतिषी बनने के लिए आवेदन करें। सार्वजनिक होने से पहले आपकी पेशेवर प्रोफ़ाइल की समीक्षा की जाएगी।","Astrologer Applications":"ज्योतिषी आवेदन","Astrologer Withdrawals":"ज्योतिषी निकासी","Bank/UPI details are private and visible only to Admin. They will not be shown again in full to the Astrologer.":"बैंक/UPI विवरण निजी हैं और केवल एडमिन को दिखाई देते हैं। इन्हें ज्योतिषी को दोबारा पूरी तरह नहीं दिखाया जाएगा।","CONTINUE TO DASHBOARD":"डैशबोर्ड पर जाएँ","Contact Us":"हमसे संपर्क करें","Create your private customer account to access the secure consultation area and choose an approved astrologer.":"सुरक्षित परामर्श क्षेत्र में जाने और स्वीकृत ज्योतिषी चुनने के लिए अपना निजी ग्राहक खाता बनाएँ।","Date of Birth":"जन्म तिथि","Email *":"ईमेल *","Enter the birth details of the person for whom you are asking the question.":"जिस व्यक्ति के लिए आप प्रश्न पूछ रहे हैं, उसके जन्म विवरण दर्ज करें।","Female":"महिला","Gender (Optional)":"लिंग (वैकल्पिक)","Have a question? Send us your details and query. Our admin team will contact you soon.":"कोई प्रश्न है? अपने विवरण और प्रश्न भेजें। हमारी एडमिन टीम जल्द ही आपसे संपर्क करेगी।","Loading answers...":"उत्तर लोड हो रहे हैं...","Loading applications...":"आवेदन लोड हो रहे हैं...","Loading approved astrologers...":"स्वीकृत ज्योतिषी लोड हो रहे हैं...","Loading current question price...":"वर्तमान प्रश्न मूल्य लोड हो रहा है...","Loading questions...":"प्रश्न लोड हो रहे हैं...","Loading withdrawal requests...":"निकासी अनुरोध लोड हो रहे हैं...","Male":"पुरुष","Mobile Number *":"मोबाइल नंबर *","Name":"नाम","Name *":"नाम *","Other":"अन्य","Payment Method":"भुगतान विधि","Payment Successful ✓":"भुगतान सफल ✓","Place / City *":"स्थान / शहर *","Place of Birth":"जन्म स्थान","Prefer not to say":"कहना नहीं चाहते","Profile Photo":"प्रोफ़ाइल फोटो","Public Question Approval":"सार्वजनिक प्रश्न स्वीकृति","Query *":"प्रश्न *","Recent Questions":"हाल के प्रश्न","Register according to your purpose. Customer and Astrologer accounts are kept separate, with each journey designed for its own needs.":"अपने उद्देश्य के अनुसार पंजीकरण करें। ग्राहक और ज्योतिषी खाते अलग रखे जाते हैं और प्रत्येक यात्रा उसकी आवश्यकताओं के अनुसार बनाई गई है।","Register as Astrologer":"ज्योतिषी के रूप में पंजीकरण करें","Register as Customer":"ग्राहक के रूप में पंजीकरण करें","SAVE COMMISSION":"कमीशन सहेजें","SAVE PRICE":"मूल्य सहेजें","SAVE WORD LIMIT":"शब्द सीमा सहेजें","SEND QUERY":"प्रश्न भेजें","SMV ASTRO administration and approval center":"SMV ASTRO प्रशासन और स्वीकृति केंद्र","SUBMIT REGISTRATION":"पंजीकरण जमा करें","Time of Birth":"जन्म समय","Your payment has been securely verified.":"आपका भुगतान सुरक्षित रूप से सत्यापित हो गया है।","Your profile will remain pending until SMV ASTRO approves it.":"SMV ASTRO द्वारा स्वीकृत किए जाने तक आपकी प्रोफ़ाइल लंबित रहेगी।","of the rejection decision.":"अस्वीकृति के निर्णय से","← Home":"← होम","Bank Name":"बैंक का नाम","Full name":"पूरा नाम","MARK PAID":"भुगतान किया गया चिन्हित करें","Your name":"आपका नाम","Your place":"आपका स्थान","SAVE CHANGES":"परिवर्तन सहेजें","Admin Answer":"एडमिन उत्तर","Logout failed":"लॉगआउट विफल","REJECT ANSWER":"उत्तर अस्वीकार करें","REJECT REVIEW":"समीक्षा अस्वीकार करें","RETRY PAYMENT":"भुगतान फिर से प्रयास करें","Submit Review":"समीक्षा जमा करें","APPROVE ANSWER":"उत्तर स्वीकृत करें","Review Deleted":"समीक्षा हटाई गई","Your full name":"आपका पूरा नाम","Answer Approved":"उत्तर स्वीकृत","Customer review":"ग्राहक समीक्षा","MARK PROCESSING":"प्रोसेसिंग चिन्हित करें","Withdrawal paid":"निकासी का भुगतान किया गया","Answer Submitted":"उत्तर जमा किया गया","No answer found.":"कोई उत्तर नहीं मिला।","Unable to Submit":"जमा नहीं किया जा सका","Please try again.":"कृपया फिर से प्रयास करें।","Review not found.":"समीक्षा नहीं मिली।","SAVING PROFILE...":"प्रोफ़ाइल सहेजी जा रही है...","Verified Customer":"सत्यापित ग्राहक","Write your review":"अपनी समीक्षा लिखें","REQUEST WITHDRAWAL":"निकासी का अनुरोध करें","Your mobile number":"आपका मोबाइल नंबर","Account Holder Name":"खाता धारक का नाम","CREATING PAYMENT...":"भुगतान बनाया जा रहा है...","Please login again.":"कृपया फिर से लॉगिन करें।","Question not found.":"प्रश्न नहीं मिला।","REQUEST APPOINTMENT":"अपॉइंटमेंट का अनुरोध करें","Withdrawal rejected":"निकासी अस्वीकार की गई","OPENING DASHBOARD...":"डैशबोर्ड खोला जा रहा है...","Available to Withdraw":"निकासी के लिए उपलब्ध","Enter a valid amount.":"मान्य राशि दर्ज करें।","New Question Assigned":"नया प्रश्न सौंपा गया","Profile lookup failed":"प्रोफ़ाइल प्राप्त नहीं हो सकी","Question Not Approved":"प्रश्न स्वीकृत नहीं है","Please login as Admin.":"कृपया एडमिन के रूप में लॉगिन करें।","Enter rejection reason.":"अस्वीकृति का कारण दर्ज करें।","Invalid question price.":"प्रश्न मूल्य अमान्य है।","Please enter your name.":"कृपया अपना नाम दर्ज करें।","Please write an answer.":"कृपया उत्तर लिखें।","SMV ASTRO payment error":"SMV ASTRO भुगतान त्रुटि","Unable to Reject Review":"समीक्षा अस्वीकार नहीं की जा सकी","Answer requires revision":"उत्तर में संशोधन आवश्यक है","Review submission error:":"समीक्षा जमा करने में त्रुटि:","Unable to edit question.":"प्रश्न संपादित नहीं किया जा सका।","Verified customer review":"सत्यापित ग्राहक समीक्षा","Withdrawal is processing":"निकासी प्रक्रिया में है","Write your query here...":"अपना प्रश्न यहाँ लिखें...","Appointment update error:":"अपॉइंटमेंट अपडेट त्रुटि:","Pending from registration":"पंजीकरण से लंबित","Please write your review.":"कृपया अपनी समीक्षा लिखें।","Public Astrology Question":"सार्वजनिक ज्योतिष प्रश्न","Withdrawal request error:":"निकासी अनुरोध त्रुटि:","Appointment booking error:":"अपॉइंटमेंट बुकिंग त्रुटि:","Profile photo is required.":"प्रोफ़ाइल फोटो आवश्यक है।","Astrologer is not assigned.":"ज्योतिषी नियुक्त नहीं है।","Earnings calculation error:":"कमाई गणना त्रुटि:","Please select Chat or Call.":"Chat या Call चुनें।","Incorrect email or password.":"ईमेल या पासवर्ड गलत है।","New customer? Create account":"नए ग्राहक हैं? खाता बनाएँ","Payment verification failed.":"भुगतान सत्यापन विफल हुआ।","Please login before booking.":"बुकिंग से पहले लॉगिन करें।","Unable to save Admin answer.":"एडमिन उत्तर सहेजा नहीं जा सका।","Customer Login Required":"ग्राहक लॉगिन आवश्यक है","Dashboard retry failed:":"डैशबोर्ड पुनः प्रयास विफल:","Please select your preferred date.":"अपनी पसंद की तारीख चुनें।","Please select your preferred time.":"अपना पसंदीदा समय चुनें।","Please select a rating from 1 to 5.":"1 से 5 तक रेटिंग चुनें।","Select another approved astrologer.":"दूसरे स्वीकृत ज्योतिषी को चुनें।","Create your secure customer account.":"अपना सुरक्षित ग्राहक खाता बनाएँ।","Enter a valid commission percentage.":"मान्य कमीशन प्रतिशत दर्ज करें।","This question is no longer available.":"यह प्रश्न अब उपलब्ध नहीं है।","This question is not assigned to you.":"यह प्रश्न आपको सौंपा नहीं गया है।","Write your astrology question here...":"अपना ज्योतिषीय प्रश्न यहाँ लिखें...","Astrologer information does not match.":"ज्योतिषी की जानकारी मेल नहीं खाती।","Question Re-assigned by Admin":"प्रश्न एडमिन द्वारा फिर से सौंपा गया","Question updated successfully.":"प्रश्न सफलतापूर्वक अपडेट किया गया।","Admin data could not be loaded.":"एडमिन डेटा लोड नहीं किया जा सका।","Unable to re-allocate question.":"प्रश्न फिर से आवंटित नहीं किया जा सका।","Please enter the Admin answer.":"एडमिन उत्तर दर्ज करें।","Profile dialog is unavailable.":"प्रोफ़ाइल विंडो उपलब्ध नहीं है।","Question price is not configured.":"प्रश्न मूल्य कॉन्फ़िगर नहीं किया गया है।","Please enter your mobile number.":"कृपया अपना मोबाइल नंबर दर्ज करें।","This action could not be opened.":"यह क्रिया खोली नहीं जा सकी।","This is not a valid Customer ID.":"यह मान्य ग्राहक ID नहीं है।","Approved astrologers load failed:":"स्वीकृत ज्योतिषियों को लोड नहीं किया जा सका:","Question approved and allocated to ":"प्रश्न स्वीकृत और आवंटित किया गया: ","Question email notification failed:":"प्रश्न ईमेल सूचना विफल हुई:","Language":"भाषा"};
    const attrs=['placeholder','aria-label','title'];
    const originals=new WeakMap();
    function replaceText(text,dict){
      if(!text||!dict)return text;
      let out=text;
      Object.keys(dict).sort((a,b)=>b.length-a.length).forEach(k=>{if(out.includes(k))out=out.split(k).join(dict[k]);});
      return out;
    }
    function translate(root,lang){
      const dict=lang==='ta'?Object.assign({},T,UI_T,EXTRA_T):lang==='hi'?Object.assign({},H,UI_H,EXTRA_H):null;
      const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
      let n; while(n=walker.nextNode()){
        if(!n.nodeValue.trim()||n.parentElement?.closest('script,style'))continue;
        if(!originals.has(n)) originals.set(n,n.nodeValue);
        n.nodeValue=dict?replaceText(originals.get(n),dict):originals.get(n);
      }
      root.querySelectorAll?.('*').forEach(el=>attrs.forEach(a=>{
        if(!el.hasAttribute(a))return;
        const key='smvOrig_'+a;
        if(!el.dataset[key])el.dataset[key]=el.getAttribute(a);
        el.setAttribute(a,dict?replaceText(el.dataset[key],dict):el.dataset[key]);
      }));
    }
    function apply(lang){
      currentLang=['en','ta'].includes(lang)?lang:'en';
      window.__smvCurrentLanguage=currentLang;
      select.value=currentLang;document.documentElement.lang=currentLang;
      document.body.classList.toggle('lang-tamil',currentLang==='ta');
      translate(document.body,currentLang);
      try{localStorage.setItem('smvLanguage',currentLang);}catch(_e){}
    }
    select.addEventListener('change',()=>apply(select.value));
    const observer=new MutationObserver(muts=>{
      if(currentLang==='en')return;
      muts.forEach(m=>{
        if(m.type==='childList'){
          m.addedNodes.forEach(n=>{
            if(n.nodeType===1){translate(n,currentLang);setTimeout(()=>translate(n,currentLang),0);}
            else if(n.nodeType===3 && n.parentElement){translate(n.parentElement,currentLang);}
          });
        }else if(m.type==='characterData'){
          const n=m.target;
          if(!n||!n.parentElement||n.parentElement.closest('script,style'))return;
          const existing=originals.get(n);
          if(existing && existing!==n.nodeValue){
            const dict=currentLang==='ta'?Object.assign({},T,UI_T,EXTRA_T):currentLang==='hi'?Object.assign({},H,UI_H,EXTRA_H):null;
            const translatedExisting=dict?replaceText(existing,dict):existing;
            if(n.nodeValue!==translatedExisting) originals.set(n,n.nodeValue);
          }else if(!existing){ originals.set(n,n.nodeValue); }
          translate(n.parentElement,currentLang);
        }
      });
    });
    observer.observe(document.body,{childList:true,subtree:true,characterData:true});
    let saved='en';try{saved=localStorage.getItem('smvLanguage')||'en';}catch(_e){}
    apply(saved);
    window.__smvApplyHoroscopeLanguage?.(currentLang);
    select.addEventListener('change',()=>window.__smvApplyHoroscopeLanguage?.(select.value));
    window.__smvToggleLanguage=()=>apply(select.value==='en'?'ta':select.value==='ta'?'hi':'en');
    window.__smvTranslateCurrentLanguage=()=>translate(document.body,currentLang);
  }
  window.__smvNotifyQuestionUpdate=async function(questionId,event,reason){
    try{
      const u=auth?.currentUser;
      if(!u||!questionId)return;
      const token=await u.getIdToken();
      const r=await fetch(BACKEND+'/question-notify',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({questionId,event,reason:reason||''})});
      if(!r.ok){const d=await r.json().catch(()=>({}));console.warn('Question email notification failed:',d.error||r.status);}
    }catch(e){console.warn('Question email notification failed:',e);}
  }
  let bookingSubmitting=false;
  function setupBooking(){
    document.querySelectorAll('[data-open-booking]').forEach(b=>b.onclick=()=>{show("appointment");if($('apType'))$('apType').value=b.dataset.openBooking;location.hash='appointment';$('apName')?.focus();});
    const f=$('appointmentForm');if(!f)return;
    if(f.dataset.smvBookingBound==='1')return;
    f.dataset.smvBookingBound='1';
    f.addEventListener('submit',async e=>{
      e.preventDefault();
      if(bookingSubmitting)return;
      const btn=$('appointmentSubmit'),msg=$('appointmentMsg');
      bookingSubmitting=true;btn.disabled=true;btn.textContent='SENDING...';
      try{
        const u=auth?.currentUser;
        if(!u)throw new Error('Please login before booking.');
        await u.reload();
        const freshUser=auth.currentUser;
        if(!freshUser)throw new Error('Please login before booking.');
        if(!freshUser.emailVerified)throw new Error('Please verify your email before booking.');
        const payload={
          name:$('apName')?.value.trim()||'',email:$('apEmail')?.value.trim()||freshUser.email||'',mobile:$('apMobile')?.value.trim()||'',
          type:$('apType')?.value||'',preferredDate:$('apDate')?.value||'',preferredTime:$('apTime')?.value||'',notes:$('apNotes')?.value.trim()||'',
          customerId:freshUser.uid,status:'new'
        };
        if(!payload.name)throw new Error('Please enter your name.');
        if(!payload.mobile)throw new Error('Please enter your mobile number.');
        if(!payload.type)throw new Error('Please select Chat or Call.');
        if(!payload.preferredDate)throw new Error('Please select your preferred date.');
        if(!payload.preferredTime)throw new Error('Please select your preferred time.');
        const token=await freshUser.getIdToken(true);
        const r=await fetch(BACKEND+'/appointment-booking',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify(payload),cache:'no-store'});
        const d=await r.json().catch(()=>({}));
        if(!r.ok)throw new Error(d.error||`Booking request returned HTTP ${r.status}.`);
        console.log('Booking created:',d.bookingId);
        msg.innerHTML='<span class="success">✓ Booking request submitted.<br><b>Booking ID:</b> '+esc(d.bookingId||'')+'<br>Admin will confirm your consultation.</span>';
        f.reset();
      }catch(err){console.error('Appointment booking error:',err);msg.innerHTML='<span class="error">'+esc(err.message||String(err))+'</span>';}
      finally{bookingSubmitting=false;btn.disabled=false;btn.textContent='REQUEST APPOINTMENT';}
    });
  }
  function setupAsk(){
  // IMPORTANT: this script is a separate ES module from the main app module.
  // openQuestionService() is therefore not in this module's lexical scope.
  // Always cross the module boundary through the explicit window bridge.
  $('quickAskBtn')?.addEventListener('click',e=>{
    e.preventDefault();
    const openQuestion=window.__smvOpenQuestionService;
    if(typeof openQuestion==='function'){
      openQuestion();
    }else{
      window.__smvPendingAskClick=true;
      console.error('SMV ASTRO: question service bridge is not ready.');
    }
  });
  document.querySelectorAll('[data-open-booking]').forEach(b=>{
    b.onclick=()=>{
      show('appointment');
      if($('apType')) $('apType').value=b.dataset.openBooking;
      $('appointment')?.scrollIntoView({behavior:'smooth',block:'start'});
      $('apName')?.focus();
    };
  });
}
  let adminRefreshRunning=false;
  async function refreshAdminSections(){
    if($('admin')?.classList.contains('hidden'))return;
    if(adminRefreshRunning)return;
    adminRefreshRunning=true;
    try{
      await loadAdminAppointments();
    }finally{adminRefreshRunning=false;}
  }
  function hookAdmin(){
    if(window.__SMV_ADMIN_HOOKED)return;
    window.__SMV_ADMIN_HOOKED=true;
    window.__smvRefreshAdminSections=refreshAdminSections;
  }
  setupBooking();setupAsk();loadQuestionPrice().catch(()=>{});loadAstroCards().catch(()=>{});console.log("AUTH CHECK:", currentUser);hookAdmin();
  // Admin data loaders are triggered explicitly after Admin authentication.
})();
  document.getElementById("contactNav")?.addEventListener("click",e=>{e.preventDefault();document.getElementById("contact")?.classList.remove("hidden");document.getElementById("contact")?.scrollIntoView({behavior:"smooth",block:"start"});});
