// Shared Tamil/English admin controls. All changes use authenticated backend APIs.
export function renderAdminWorkflows({data, api, refresh, lang, escape: esc, date}) {
  const ta=lang==='ta', t=(en,taText)=>ta?taText:en;
  const rows=(data.questions||[]).slice().sort((a,b)=>stamp(b)-stamp(a));
  function stamp(q){const v=q.updatedAt||q.createdAt;return Number(v?._seconds||v?.seconds||0)*1000||Date.parse(v)||0;}
  const rejected=q=>['question_rejected','admin_rejected'].includes(q.status);
  const open=q=>!rejected(q)&&q.status!=='answered'&&(q.paymentStatus==='paid'||q.customerPaymentId||q.razorpayPaymentId||['paid','pending_admin_approval','admin_approved','assigned_to_astrologer','available_to_astrologers','claimed_by_astrologer','processing','answer_draft','admin_review','revision_required'].includes(q.status));
  const astros=(data.astrologers||[]).filter(a=>a.status==='approved');
  const statuses={paid:t('Paid','கட்டணம் பெறப்பட்டது'),pending_admin_approval:t('Awaiting question approval','கேள்வி அங்கீகாரத்திற்குக் காத்திருக்கிறது'),admin_approved:t('Approved','அங்கீகரிக்கப்பட்டது'),processing:t('Answer awaiting review','பதில் பரிசீலனையில் உள்ளது'),admin_review:t('Answer awaiting review','பதில் பரிசீலனையில் உள்ளது'),answer_draft:t('Answer awaiting review','பதில் பரிசீலனையில் உள்ளது'),revision_required:t('Revision requested','பதில் திருத்தம் கோரப்பட்டுள்ளது'),answered:t('Answered','பதிலளிக்கப்பட்டது'),question_rejected:t('Question rejected','கேள்வி நிராகரிக்கப்பட்டது'),admin_rejected:t('Question rejected','கேள்வி நிராகரிக்கப்பட்டது'),pending:t('Pending','நிலுவையில் உள்ளது'),created:t('Created','உருவாக்கப்பட்டது'),initiated:t('Initiated','தொடங்கப்பட்டது'),processing_refund:t('Processing','செயலாக்கத்தில் உள்ளது'),processed:t('Refund processed','பணத்திருப்பம் செயலாக்கப்பட்டது'),completed:t('Completed','முடிந்தது'),failed:t('Failed — admin action required','தோல்வி — நிர்வாக நடவடிக்கை தேவை'),available_to_astrologers:t('Open to astrologers','ஜோதிடர்களுக்குக் கிடைக்கிறது'),claimed_by_astrologer:t('Claimed by astrologer','ஜோதிடர் ஏற்றுக்கொண்டார்'),assigned_to_astrologer:t('Allocated','ஒதுக்கப்பட்டது'),awaiting_payment:t('Awaiting payment','கட்டணத்திற்குக் காத்திருக்கிறது'),payment_failed:t('Payment failed','கட்டணம் தோல்வியடைந்தது')};
  const label=s=>statuses[s]||s||t('Pending','நிலுவையில் உள்ளது');
  function button(action,en,tamil){return `<button type="button" class="btn" data-workflow="${action}">${t(en,tamil)}</button>`;}
  function card(q,mode){
    const id=String(q.id||q.questionId||''), assigned=!!q.astrologerId;
    const amount=Number(q.amount||q.paymentAmount||0);
    const birth=q.birthDetails||{};
    const birthLine=[q.birthDate||birth.birthDate,q.birthTime||birth.birthTime,q.birthPlace||birth.birthPlace].filter(Boolean).join(' · ');
    const details=`<p><b>${t('Customer','வாடிக்கையாளர்')}:</b> <span translate="no">${esc(q.customerName||q.birthName||birth.name||'—')}</span></p>${birthLine?`<p>${t('Birth details','பிறப்பு விவரங்கள்')}: <span translate="no">${esc(birthLine)}</span></p>`:''}<p><b>${t('Question ID','கேள்வி எண்')}:</b> ${esc(id)}</p><p class="smv-user-content" translate="no">${esc(q.question||'')}</p><p>${t('Status','நிலை')}: <b>${esc(label(q.status))}</b> · ₹${amount.toFixed(2)}</p>${q.astrologerName?`<p>${t('Astrologer','ஜோதிடர்')}: <span translate="no">${esc(q.astrologerName)}</span></p>`:''}<p class="small">${t('Payment ID','கட்டண எண்')}: ${esc(q.customerPaymentId||q.razorpayPaymentId||'—')}</p>`;
    let controls='';
    if(mode==='refund'){
      controls=`<p>${t('Refund status','பணத்திருப்ப நிலை')}: <b>${esc(label(q.refundStatus))}</b></p><p>${t('Refund amount','பணத்திருப்பத் தொகை')}: ₹${Number(q.refundAmount||amount).toFixed(2)}</p><p>${t('Refund ID','பணத்திருப்ப எண்')}: ${esc(q.refundId||'—')}</p>${q.refundRrn?`<p>RRN: ${esc(q.refundRrn)}</p>`:''}<p class="smv-user-content" translate="no">${esc(q.refundReason||q.adminQuestionRejectionReason||'')}</p>${q.refundId?button('sync-refund','Refresh refund status','பணத்திருப்ப நிலையைப் புதுப்பி'):`<p class="error">${t('No refund ID has been created. Check the payment and refund error in Razorpay before taking further action.','பணத்திருப்ப எண் உருவாகவில்லை. அடுத்த நடவடிக்கைக்கு முன் Razorpay-ல் கட்டணத்தையும் பணத்திருப்பப் பிழையையும் சரிபார்க்கவும்.')}</p>`}`;
    } else if(mode!=='history'){
      const pct=Number(q.commissionPercent??q.commissionRate??data.settings?.commission?.astroPercent??20);
      controls=`${q.answer?`<details open><summary>${t('Submitted answer','சமர்ப்பிக்கப்பட்ட பதில்')}</summary><p class="smv-user-content" translate="no" style="white-space:pre-wrap">${esc(q.answer)}</p></details><div class="action-row">${button('approve-answer','Approve answer','பதிலை அங்கீகரி')}${button('reject-answer','Reject answer','பதிலை நிராகரி')}</div>`:''}<div class="action-row"><label>${t('Astrologer','ஜோதிடர்')}<select data-field="astrologer"><option value="">${t('Select astrologer','ஜோதிடரைத் தேர்ந்தெடுக்கவும்')}</option>${astros.map(a=>`<option value="${esc(a.id)}" ${a.id===q.astrologerId?'selected':''}>${esc(a.name||a.id)}</option>`).join('')}</select></label><label>${t('Astrologer commission %','ஜோதிடர் பங்கு %')}<input data-field="commission" type="number" min="0" max="100" step="0.01" value="${pct}"></label>${button(assigned?'reallocate-question':'approve-question',assigned?'Reallocate':'Approve & allocate',assigned?'மறு ஒதுக்கீடு':'அங்கீகரித்து ஒதுக்கு')}</div><label>${t('Reason for rejection','நிராகரிப்பதற்கான காரணம்')}<input data-field="reason" maxlength="2000"></label><div class="action-row">${button('reject-question','Reject question & refund','கேள்வியை நிராகரித்து பணத்தைத் திருப்புக')}</div><details><summary>${t('Edit question','கேள்வியைத் திருத்து')}</summary><textarea data-field="question" rows="3" aria-label="${t('Question','கேள்வி')}">${esc(q.question||'')}</textarea>${button('edit-question','Save question','கேள்வியைச் சேமி')}</details><details><summary>${t('Admin answer','நிர்வாகி பதில்')}</summary><p class="small">${t('Minimum words','குறைந்தபட்ச சொற்கள்')}: ${Number(q.answerMinWords||1)}</p><textarea data-field="answer" rows="6" aria-label="${t('Admin answer','நிர்வாகி பதில்')}"></textarea>${button('takeover-answer','Submit admin answer','நிர்வாகி பதிலைச் சமர்ப்பி')}</details>`;
    }
    return `<article class="card smv-workflow-card" data-question="${esc(id)}">${details}${controls}<p data-workflow-message role="status" aria-live="polite"></p></article>`;
  }
  const lists=[['adminPendingQuestions',rows.filter(q=>open(q)&&!String(q.answer||'').trim()),'question'],['adminAnswers',rows.filter(q=>open(q)&&String(q.answer||'').trim()),'answer'],['adminRefunds',rows.filter(rejected),'refund'],['adminQuestions',rows.slice(0,50),'history']];
  for(const [id,items,mode] of lists){
    const box=document.getElementById(id);if(!box)continue;
    box.innerHTML=items.length?items.map(q=>card(q,mode)).join(''):`<div class="empty">${t('No items in this list.','இந்தப் பட்டியலில் பதிவுகள் இல்லை.')}</div>`;
    box.onclick=async event=>{
      const btn=event.target.closest('[data-workflow]');if(!btn||!box.contains(btn))return;
      const root=btn.closest('[data-question]'), questionId=root.dataset.question, action=btn.dataset.workflow;
      const msg=root.querySelector('[data-workflow-message]');
      const value=k=>root.querySelector(`[data-field="${k}"]`)?.value.trim()||'';
      const payload={questionId};
      if(['reject-answer','reject-question'].includes(action)){payload.reason=value('reason');if(!payload.reason){msg.textContent=t('Enter a rejection reason.','நிராகரிப்பதற்கான காரணத்தை உள்ளிடவும்.');return;}}
      if(['approve-question','reallocate-question'].includes(action)){payload.astrologerId=value('astrologer');payload.commissionPercent=Number(value('commission'));if(!payload.astrologerId||!value('commission')||!Number.isFinite(payload.commissionPercent)||payload.commissionPercent<0||payload.commissionPercent>100){msg.textContent=t('Choose an astrologer and a valid commission (0–100).','ஜோதிடரையும் சரியான பங்கு சதவீதத்தையும் (0–100) தேர்ந்தெடுக்கவும்.');return;}}
      if(action==='edit-question'){payload.question=value('question');if(!payload.question){msg.textContent=t('Enter the question.','கேள்வியை உள்ளிடவும்.');return;}}
      if(action==='takeover-answer'){payload.answer=value('answer');if(!payload.answer){msg.textContent=t('Enter your answer.','உங்கள் பதிலை உள்ளிடவும்.');return;}}
      if(action==='reject-question'&&!confirm(t('Reject this question and request a refund?','இந்தக் கேள்வியை நிராகரித்து பணத்திருப்பத்தைக் கோரவா?')))return;
      root.querySelectorAll('button').forEach(b=>b.disabled=true);msg.textContent=t('Saving…','சேமிக்கப்படுகிறது…');
      try{const result=await api('/admin/'+action,{method:'POST',body:JSON.stringify(payload)});if(!result?.success)throw Error(result?.error||t('Unable to complete action.','செயலை முடிக்க முடியவில்லை.'));msg.textContent=t('Saved. Refreshing…','சேமிக்கப்பட்டது. புதுப்பிக்கப்படுகிறது…');await refresh();}
      catch(e){msg.textContent=e.message||String(e);msg.className='error';}
      finally{root.querySelectorAll('button').forEach(b=>b.disabled=false);}
    };
  }
}
