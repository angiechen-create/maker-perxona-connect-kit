/**
 * The "Want <avatar> to introduce you?" opt-in form, in your Google Drive.
 *
 * New form:     run createOptInForm
 * Rename one:   set EXISTING_FORM_ID, run updateOptInForm (keeps the link and responses)
 *
 * 1. Open https://script.google.com → New project
 * 2. Delete everything in the editor, paste this whole file, press ⌘S
 * 3. Pick the function in the toolbar, click ▶ Run, allow access when asked
 * 4. The links appear in the Execution log at the bottom
 *
 * Question titles must stay as they are — scripts/import-form.mjs matches
 * on them. See docs/opt-in-form.md.
 */

// The avatar's name — same as `name:` in events/<slug>/persona.md.
const PERSONA = 'Maker';

// For updateOptInForm: the id in the form's edit link (…/forms/d/<id>/edit).
const EXISTING_FORM_ID = ''; // e.g. '1AbC…xyz'

const TITLE = `想讓 ${PERSONA} 幫你介紹人嗎？ / Want ${PERSONA} to introduce you?`;

const DESCRIPTION =
  `活動現場入口有一位 AI 主持人 ${PERSONA}。如果你填了這份表，當其他參加者問「我該認識誰？」，` +
  `${PERSONA} 可能會推薦你，並在螢幕上顯示你的名字、下面的回答和 LinkedIn QR code。不填就不會被介紹。\n\n` +
  `At the entrance there's an AI concierge, ${PERSONA}. If you fill this in, ${PERSONA} may recommend you when ` +
  'another attendee asks "who should I meet?", showing your name, your answers below and a ' +
  "LinkedIn QR code on screen. Skip it and you won't be introduced.";

const CONSENT =
  `我同意 ${PERSONA} 在活動現場向其他參加者介紹我，使用我的名字、上面的回答和 LinkedIn。` +
  '這些回答會交給 AI（Anthropic 的 Claude）用來配對，活動結束後刪除。/ ' +
  `I agree that ${PERSONA} may introduce me to other attendees at the event using my name, ` +
  "answers above and LinkedIn. My answers are sent to an AI (Anthropic's Claude) for " +
  'matching and deleted after the event.';

function createOptInForm() {
  const form = FormApp.create(TITLE);
  form.setDescription(DESCRIPTION);

  // The concierge never needs an email — don't collect one.
  form.setCollectEmail(false);
  form.setLimitOneResponsePerUser(false); // would force a Google sign-in
  form.setAllowResponseEdits(true);

  form.addTextItem().setTitle('你的名字 / Name').setRequired(true);
  form.addTextItem()
    .setTitle('你在做什麼？（一句話）/ What are you building? (one line)')
    .setRequired(true);
  form.addTextItem()
    .setTitle('想聊什麼、想認識怎樣的人？/ What do you want to talk about or who do you want to meet?');
  form.addTextItem().setTitle('LinkedIn 網址（選填）/ LinkedIn URL (optional)');
  form.addCheckboxItem().setTitle('同意 / Consent').setChoiceValues([CONSENT]).setRequired(true);

  form.setConfirmationMessage('謝謝！現場見 👋 / Thanks — see you there!');

  Logger.log('Edit the form:   ' + form.getEditUrl());
  Logger.log('Send this link:  ' + form.getPublishedUrl());
}

/** Renames an existing form to PERSONA. Same link, responses kept. */
function updateOptInForm() {
  const form = FormApp.openById(EXISTING_FORM_ID);
  form.setTitle(TITLE);
  form.setDescription(DESCRIPTION);
  const consent = form.getItems(FormApp.ItemType.CHECKBOX)[0];
  if (consent) consent.asCheckboxItem().setChoiceValues([CONSENT]);
  Logger.log('Updated: ' + form.getPublishedUrl());
}
