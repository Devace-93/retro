/**
 * Widget strings for the same 34 locales as the app (list mirrored from
 * apps/web/src/i18n/langs.ts). Resolution: exact locale → base language →
 * English. Country variants share the base language's strings unless a real
 * difference exists (none so far).
 */
export type Key =
  | "launcher"
  | "title"
  | "intro"
  | "bug"
  | "feedback"
  | "feature"
  | "good"
  | "bad"
  | "messagePlaceholder"
  | "emailPlaceholder"
  | "attach"
  | "remove"
  | "send"
  | "sending"
  | "thanks"
  | "thanksNumber"
  | "roadmap"
  | "close"
  | "back"
  | "error"
  | "screenshotError";

export type Strings = Record<Key, string>;

export const LOCALES = [
  "es-MX", "es-ES", "es-CO", "es-AR", "es-CL", "es-PE",
  "en-US", "en-GB", "en-CA", "en-AU", "en-NZ",
  "fr-FR", "de-DE", "de-AT", "it-IT", "pt-BR", "pt-PT", "nl-NL", "sv-SE",
  "pl-PL", "cs-CZ", "ro-RO", "el-GR", "uk-UA", "ru-RU", "tr-TR", "ar-SA",
  "hi-IN", "zh-CN", "ja-JP", "ko-KR", "vi-VN", "id-ID", "th-TH",
] as const;

export const RTL = ["ar"];
export const DEFAULT_LANG = "en-US";

const en: Strings = {
  launcher: "Send feedback",
  title: "Send feedback",
  intro: "What would you like to tell us?",
  bug: "Report a bug",
  feedback: "Share feedback",
  feature: "Suggest a feature",
  good: "I like it",
  bad: "Something's off",
  messagePlaceholder: "Tell us what happened or what you'd like…",
  emailPlaceholder: "Email (optional, if you'd like a reply)",
  attach: "Attach screenshot",
  remove: "Remove",
  send: "Send",
  sending: "Sending…",
  thanks: "Thank you! Your feedback has been received.",
  thanksNumber: "Reference #{n}",
  roadmap: "See the roadmap",
  close: "Close",
  back: "Back",
  error: "We couldn't send your feedback. Please try again.",
  screenshotError: "Screenshot capture failed. You can attach an image file instead.",
};

const es: Strings = {
  launcher: "Enviar comentarios",
  title: "Enviar comentarios",
  intro: "¿Qué quieres contarnos?",
  bug: "Reportar un error",
  feedback: "Dejar un comentario",
  feature: "Proponer una función",
  good: "Me gusta",
  bad: "Algo no va bien",
  messagePlaceholder: "Cuéntanos qué pasó o qué te gustaría…",
  emailPlaceholder: "Correo (opcional, si quieres respuesta)",
  attach: "Adjuntar captura",
  remove: "Quitar",
  send: "Enviar",
  sending: "Enviando…",
  thanks: "¡Gracias! Hemos recibido tu comentario.",
  thanksNumber: "Referencia #{n}",
  roadmap: "Ver el roadmap",
  close: "Cerrar",
  back: "Atrás",
  error: "No pudimos enviar tu comentario. Inténtalo de nuevo.",
  screenshotError: "No se pudo capturar la pantalla. Puedes adjuntar una imagen.",
};

const fr: Strings = {
  launcher: "Envoyer un avis", title: "Envoyer un avis", intro: "Que souhaitez-vous nous dire ?",
  bug: "Signaler un bug", feedback: "Donner un avis", feature: "Proposer une fonctionnalité",
  good: "J'aime", bad: "Quelque chose ne va pas",
  messagePlaceholder: "Dites-nous ce qui s'est passé ou ce que vous aimeriez…",
  emailPlaceholder: "E-mail (facultatif, pour une réponse)",
  attach: "Joindre une capture", remove: "Retirer", send: "Envoyer", sending: "Envoi…",
  thanks: "Merci ! Votre avis a bien été reçu.", thanksNumber: "Référence #{n}",
  roadmap: "Voir la feuille de route", close: "Fermer", back: "Retour",
  error: "Impossible d'envoyer votre avis. Veuillez réessayer.",
  screenshotError: "La capture a échoué. Vous pouvez joindre une image.",
};

const de: Strings = {
  launcher: "Feedback senden", title: "Feedback senden", intro: "Was möchtest du uns mitteilen?",
  bug: "Fehler melden", feedback: "Feedback geben", feature: "Funktion vorschlagen",
  good: "Gefällt mir", bad: "Etwas stimmt nicht",
  messagePlaceholder: "Erzähl uns, was passiert ist oder was du dir wünschst…",
  emailPlaceholder: "E-Mail (optional, für eine Antwort)",
  attach: "Screenshot anhängen", remove: "Entfernen", send: "Senden", sending: "Wird gesendet…",
  thanks: "Danke! Dein Feedback ist angekommen.", thanksNumber: "Referenz #{n}",
  roadmap: "Roadmap ansehen", close: "Schließen", back: "Zurück",
  error: "Dein Feedback konnte nicht gesendet werden. Bitte versuche es erneut.",
  screenshotError: "Screenshot fehlgeschlagen. Du kannst stattdessen ein Bild anhängen.",
};

const it: Strings = {
  launcher: "Invia feedback", title: "Invia feedback", intro: "Cosa vuoi dirci?",
  bug: "Segnala un bug", feedback: "Lascia un feedback", feature: "Proponi una funzione",
  good: "Mi piace", bad: "Qualcosa non va",
  messagePlaceholder: "Raccontaci cosa è successo o cosa vorresti…",
  emailPlaceholder: "Email (facoltativa, per una risposta)",
  attach: "Allega screenshot", remove: "Rimuovi", send: "Invia", sending: "Invio…",
  thanks: "Grazie! Abbiamo ricevuto il tuo feedback.", thanksNumber: "Riferimento #{n}",
  roadmap: "Vedi la roadmap", close: "Chiudi", back: "Indietro",
  error: "Non siamo riusciti a inviare il feedback. Riprova.",
  screenshotError: "Cattura schermo non riuscita. Puoi allegare un'immagine.",
};

const pt: Strings = {
  launcher: "Enviar feedback", title: "Enviar feedback", intro: "O que você quer nos contar?",
  bug: "Relatar um bug", feedback: "Deixar um comentário", feature: "Sugerir uma função",
  good: "Gostei", bad: "Algo está errado",
  messagePlaceholder: "Conte o que aconteceu ou o que você gostaria…",
  emailPlaceholder: "E-mail (opcional, se quiser resposta)",
  attach: "Anexar captura", remove: "Remover", send: "Enviar", sending: "Enviando…",
  thanks: "Obrigado! Recebemos o seu feedback.", thanksNumber: "Referência #{n}",
  roadmap: "Ver o roadmap", close: "Fechar", back: "Voltar",
  error: "Não foi possível enviar o feedback. Tente novamente.",
  screenshotError: "A captura falhou. Você pode anexar uma imagem.",
};
const ptPT: Partial<Strings> = {
  intro: "O que quer dizer-nos?", messagePlaceholder: "Conte-nos o que aconteceu ou o que gostaria…",
  emailPlaceholder: "E-mail (opcional, se quiser resposta)", screenshotError: "A captura falhou. Pode anexar uma imagem.",
};

const nl: Strings = {
  launcher: "Feedback sturen", title: "Feedback sturen", intro: "Wat wil je ons vertellen?",
  bug: "Bug melden", feedback: "Feedback geven", feature: "Functie voorstellen",
  good: "Ik vind het goed", bad: "Er is iets mis",
  messagePlaceholder: "Vertel wat er gebeurde of wat je graag zou willen…",
  emailPlaceholder: "E-mail (optioneel, voor een antwoord)",
  attach: "Screenshot toevoegen", remove: "Verwijderen", send: "Versturen", sending: "Versturen…",
  thanks: "Bedankt! We hebben je feedback ontvangen.", thanksNumber: "Referentie #{n}",
  roadmap: "Bekijk de roadmap", close: "Sluiten", back: "Terug",
  error: "Je feedback kon niet worden verstuurd. Probeer het opnieuw.",
  screenshotError: "Screenshot mislukt. Je kunt ook een afbeelding toevoegen.",
};

const sv: Strings = {
  launcher: "Skicka feedback", title: "Skicka feedback", intro: "Vad vill du berätta?",
  bug: "Rapportera en bugg", feedback: "Ge feedback", feature: "Föreslå en funktion",
  good: "Jag gillar det", bad: "Något är fel",
  messagePlaceholder: "Berätta vad som hände eller vad du önskar…",
  emailPlaceholder: "E-post (valfritt, om du vill ha svar)",
  attach: "Bifoga skärmdump", remove: "Ta bort", send: "Skicka", sending: "Skickar…",
  thanks: "Tack! Vi har tagit emot din feedback.", thanksNumber: "Referens #{n}",
  roadmap: "Se färdplanen", close: "Stäng", back: "Tillbaka",
  error: "Det gick inte att skicka din feedback. Försök igen.",
  screenshotError: "Skärmdumpen misslyckades. Du kan bifoga en bild i stället.",
};

const pl: Strings = {
  launcher: "Wyślij opinię", title: "Wyślij opinię", intro: "Co chcesz nam przekazać?",
  bug: "Zgłoś błąd", feedback: "Podziel się opinią", feature: "Zaproponuj funkcję",
  good: "Podoba mi się", bad: "Coś jest nie tak",
  messagePlaceholder: "Opisz, co się stało lub czego byś chciał…",
  emailPlaceholder: "E-mail (opcjonalnie, jeśli chcesz odpowiedź)",
  attach: "Dołącz zrzut ekranu", remove: "Usuń", send: "Wyślij", sending: "Wysyłanie…",
  thanks: "Dziękujemy! Otrzymaliśmy Twoją opinię.", thanksNumber: "Numer #{n}",
  roadmap: "Zobacz plan rozwoju", close: "Zamknij", back: "Wstecz",
  error: "Nie udało się wysłać opinii. Spróbuj ponownie.",
  screenshotError: "Zrzut ekranu nie powiódł się. Możesz dołączyć obraz.",
};

const cs: Strings = {
  launcher: "Poslat zpětnou vazbu", title: "Poslat zpětnou vazbu", intro: "Co nám chcete sdělit?",
  bug: "Nahlásit chybu", feedback: "Napsat názor", feature: "Navrhnout funkci",
  good: "Líbí se mi", bad: "Něco nefunguje",
  messagePlaceholder: "Popište, co se stalo nebo co byste chtěli…",
  emailPlaceholder: "E-mail (nepovinné, pokud chcete odpověď)",
  attach: "Přiložit snímek obrazovky", remove: "Odebrat", send: "Odeslat", sending: "Odesílání…",
  thanks: "Děkujeme! Vaši zpětnou vazbu jsme přijali.", thanksNumber: "Číslo #{n}",
  roadmap: "Zobrazit plán", close: "Zavřít", back: "Zpět",
  error: "Zpětnou vazbu se nepodařilo odeslat. Zkuste to znovu.",
  screenshotError: "Snímek obrazovky se nezdařil. Můžete přiložit obrázek.",
};

const ro: Strings = {
  launcher: "Trimite feedback", title: "Trimite feedback", intro: "Ce vrei să ne spui?",
  bug: "Raportează o eroare", feedback: "Lasă un comentariu", feature: "Propune o funcție",
  good: "Îmi place", bad: "Ceva nu e în regulă",
  messagePlaceholder: "Spune-ne ce s-a întâmplat sau ce ți-ai dori…",
  emailPlaceholder: "E-mail (opțional, dacă vrei răspuns)",
  attach: "Atașează o captură", remove: "Elimină", send: "Trimite", sending: "Se trimite…",
  thanks: "Mulțumim! Am primit feedbackul tău.", thanksNumber: "Referință #{n}",
  roadmap: "Vezi planul", close: "Închide", back: "Înapoi",
  error: "Nu am putut trimite feedbackul. Încearcă din nou.",
  screenshotError: "Captura a eșuat. Poți atașa o imagine.",
};

const el: Strings = {
  launcher: "Στείλτε σχόλια", title: "Στείλτε σχόλια", intro: "Τι θα θέλατε να μας πείτε;",
  bug: "Αναφορά σφάλματος", feedback: "Αφήστε σχόλιο", feature: "Προτείνετε λειτουργία",
  good: "Μου αρέσει", bad: "Κάτι δεν πάει καλά",
  messagePlaceholder: "Πείτε μας τι συνέβη ή τι θα θέλατε…",
  emailPlaceholder: "Email (προαιρετικό, για απάντηση)",
  attach: "Επισύναψη στιγμιότυπου", remove: "Αφαίρεση", send: "Αποστολή", sending: "Αποστολή…",
  thanks: "Ευχαριστούμε! Λάβαμε τα σχόλιά σας.", thanksNumber: "Αριθμός #{n}",
  roadmap: "Δείτε το roadmap", close: "Κλείσιμο", back: "Πίσω",
  error: "Δεν ήταν δυνατή η αποστολή. Δοκιμάστε ξανά.",
  screenshotError: "Η λήψη απέτυχε. Μπορείτε να επισυνάψετε εικόνα.",
};

const uk: Strings = {
  launcher: "Надіслати відгук", title: "Надіслати відгук", intro: "Що ви хочете нам сказати?",
  bug: "Повідомити про помилку", feedback: "Залишити відгук", feature: "Запропонувати функцію",
  good: "Мені подобається", bad: "Щось не так",
  messagePlaceholder: "Розкажіть, що сталося або чого б ви хотіли…",
  emailPlaceholder: "Email (необов'язково, якщо бажаєте відповідь)",
  attach: "Додати знімок екрана", remove: "Видалити", send: "Надіслати", sending: "Надсилання…",
  thanks: "Дякуємо! Ми отримали ваш відгук.", thanksNumber: "Номер #{n}",
  roadmap: "Переглянути план", close: "Закрити", back: "Назад",
  error: "Не вдалося надіслати відгук. Спробуйте ще раз.",
  screenshotError: "Не вдалося зробити знімок. Ви можете додати зображення.",
};

const ru: Strings = {
  launcher: "Отправить отзыв", title: "Отправить отзыв", intro: "Что вы хотите нам сказать?",
  bug: "Сообщить об ошибке", feedback: "Оставить отзыв", feature: "Предложить функцию",
  good: "Мне нравится", bad: "Что-то не так",
  messagePlaceholder: "Расскажите, что случилось или чего бы вы хотели…",
  emailPlaceholder: "Email (необязательно, если нужен ответ)",
  attach: "Прикрепить скриншот", remove: "Удалить", send: "Отправить", sending: "Отправка…",
  thanks: "Спасибо! Мы получили ваш отзыв.", thanksNumber: "Номер #{n}",
  roadmap: "Посмотреть план", close: "Закрыть", back: "Назад",
  error: "Не удалось отправить отзыв. Попробуйте ещё раз.",
  screenshotError: "Не удалось сделать скриншот. Вы можете прикрепить изображение.",
};

const tr: Strings = {
  launcher: "Geri bildirim gönder", title: "Geri bildirim gönder", intro: "Bize ne söylemek istersiniz?",
  bug: "Hata bildir", feedback: "Görüş paylaş", feature: "Özellik öner",
  good: "Beğendim", bad: "Bir sorun var",
  messagePlaceholder: "Ne olduğunu ya da ne istediğinizi anlatın…",
  emailPlaceholder: "E-posta (isteğe bağlı, yanıt için)",
  attach: "Ekran görüntüsü ekle", remove: "Kaldır", send: "Gönder", sending: "Gönderiliyor…",
  thanks: "Teşekkürler! Geri bildiriminiz alındı.", thanksNumber: "Referans #{n}",
  roadmap: "Yol haritasını gör", close: "Kapat", back: "Geri",
  error: "Geri bildirim gönderilemedi. Lütfen tekrar deneyin.",
  screenshotError: "Ekran görüntüsü alınamadı. Bunun yerine bir resim ekleyebilirsiniz.",
};

const ar: Strings = {
  launcher: "إرسال ملاحظات", title: "إرسال ملاحظات", intro: "ماذا تود أن تقول لنا؟",
  bug: "الإبلاغ عن خطأ", feedback: "مشاركة رأي", feature: "اقتراح ميزة",
  good: "أعجبني", bad: "هناك مشكلة",
  messagePlaceholder: "أخبرنا بما حدث أو بما تريد…",
  emailPlaceholder: "البريد الإلكتروني (اختياري، إذا أردت ردًا)",
  attach: "إرفاق لقطة شاشة", remove: "إزالة", send: "إرسال", sending: "جارٍ الإرسال…",
  thanks: "شكرًا لك! تم استلام ملاحظاتك.", thanksNumber: "المرجع #{n}",
  roadmap: "عرض خارطة الطريق", close: "إغلاق", back: "رجوع",
  error: "تعذر إرسال ملاحظاتك. حاول مرة أخرى.",
  screenshotError: "فشل التقاط الشاشة. يمكنك إرفاق صورة بدلًا من ذلك.",
};

const hi: Strings = {
  launcher: "प्रतिक्रिया भेजें", title: "प्रतिक्रिया भेजें", intro: "आप हमें क्या बताना चाहेंगे?",
  bug: "बग रिपोर्ट करें", feedback: "प्रतिक्रिया दें", feature: "फ़ीचर सुझाएँ",
  good: "मुझे पसंद है", bad: "कुछ गड़बड़ है",
  messagePlaceholder: "बताएँ क्या हुआ या आप क्या चाहते हैं…",
  emailPlaceholder: "ईमेल (वैकल्पिक, यदि आप उत्तर चाहते हैं)",
  attach: "स्क्रीनशॉट जोड़ें", remove: "हटाएँ", send: "भेजें", sending: "भेजा जा रहा है…",
  thanks: "धन्यवाद! आपकी प्रतिक्रिया मिल गई है।", thanksNumber: "संदर्भ #{n}",
  roadmap: "रोडमैप देखें", close: "बंद करें", back: "वापस",
  error: "प्रतिक्रिया नहीं भेजी जा सकी। कृपया फिर कोशिश करें।",
  screenshotError: "स्क्रीनशॉट नहीं लिया जा सका। आप एक छवि जोड़ सकते हैं।",
};

const zh: Strings = {
  launcher: "发送反馈", title: "发送反馈", intro: "您想告诉我们什么？",
  bug: "报告问题", feedback: "提出意见", feature: "建议功能",
  good: "我喜欢", bad: "有点问题",
  messagePlaceholder: "告诉我们发生了什么，或您希望有什么…",
  emailPlaceholder: "邮箱（可选，如需回复）",
  attach: "附加截图", remove: "移除", send: "发送", sending: "发送中…",
  thanks: "感谢您！我们已收到您的反馈。", thanksNumber: "编号 #{n}",
  roadmap: "查看路线图", close: "关闭", back: "返回",
  error: "反馈发送失败，请重试。",
  screenshotError: "截图失败。您可以改为附加图片。",
};

const ja: Strings = {
  launcher: "フィードバックを送る", title: "フィードバックを送る", intro: "どんなことをお聞かせいただけますか？",
  bug: "バグを報告", feedback: "感想を送る", feature: "機能を提案",
  good: "気に入った", bad: "何かおかしい",
  messagePlaceholder: "何が起きたか、またはご要望をお書きください…",
  emailPlaceholder: "メール（任意・返信をご希望の場合）",
  attach: "スクリーンショットを添付", remove: "削除", send: "送信", sending: "送信中…",
  thanks: "ありがとうございます！フィードバックを受け付けました。", thanksNumber: "受付番号 #{n}",
  roadmap: "ロードマップを見る", close: "閉じる", back: "戻る",
  error: "送信できませんでした。もう一度お試しください。",
  screenshotError: "画面キャプチャに失敗しました。画像ファイルを添付できます。",
};

const ko: Strings = {
  launcher: "피드백 보내기", title: "피드백 보내기", intro: "어떤 이야기를 전하고 싶으신가요?",
  bug: "버그 신고", feedback: "의견 남기기", feature: "기능 제안",
  good: "좋아요", bad: "문제가 있어요",
  messagePlaceholder: "무슨 일이 있었는지 또는 원하시는 점을 알려주세요…",
  emailPlaceholder: "이메일 (선택, 답변을 원하시면)",
  attach: "스크린샷 첨부", remove: "제거", send: "보내기", sending: "보내는 중…",
  thanks: "감사합니다! 피드백이 접수되었습니다.", thanksNumber: "접수 번호 #{n}",
  roadmap: "로드맵 보기", close: "닫기", back: "뒤로",
  error: "피드백을 보낼 수 없었습니다. 다시 시도해 주세요.",
  screenshotError: "화면 캡처에 실패했습니다. 이미지 파일을 첨부할 수 있습니다.",
};

const vi: Strings = {
  launcher: "Gửi phản hồi", title: "Gửi phản hồi", intro: "Bạn muốn nói gì với chúng tôi?",
  bug: "Báo lỗi", feedback: "Góp ý", feature: "Đề xuất tính năng",
  good: "Tôi thích", bad: "Có gì đó không ổn",
  messagePlaceholder: "Hãy kể điều gì đã xảy ra hoặc bạn mong muốn gì…",
  emailPlaceholder: "Email (không bắt buộc, nếu bạn muốn được trả lời)",
  attach: "Đính kèm ảnh chụp màn hình", remove: "Xóa", send: "Gửi", sending: "Đang gửi…",
  thanks: "Cảm ơn bạn! Chúng tôi đã nhận được phản hồi.", thanksNumber: "Mã tham chiếu #{n}",
  roadmap: "Xem lộ trình", close: "Đóng", back: "Quay lại",
  error: "Không thể gửi phản hồi. Vui lòng thử lại.",
  screenshotError: "Chụp màn hình thất bại. Bạn có thể đính kèm một hình ảnh.",
};

const id: Strings = {
  launcher: "Kirim masukan", title: "Kirim masukan", intro: "Apa yang ingin Anda sampaikan?",
  bug: "Laporkan bug", feedback: "Beri masukan", feature: "Usulkan fitur",
  good: "Saya suka", bad: "Ada yang salah",
  messagePlaceholder: "Ceritakan apa yang terjadi atau apa yang Anda inginkan…",
  emailPlaceholder: "Email (opsional, jika ingin balasan)",
  attach: "Lampirkan tangkapan layar", remove: "Hapus", send: "Kirim", sending: "Mengirim…",
  thanks: "Terima kasih! Masukan Anda telah kami terima.", thanksNumber: "Referensi #{n}",
  roadmap: "Lihat roadmap", close: "Tutup", back: "Kembali",
  error: "Masukan tidak dapat dikirim. Silakan coba lagi.",
  screenshotError: "Tangkapan layar gagal. Anda dapat melampirkan gambar.",
};

const th: Strings = {
  launcher: "ส่งความคิดเห็น", title: "ส่งความคิดเห็น", intro: "คุณอยากบอกอะไรเรา?",
  bug: "รายงานข้อผิดพลาด", feedback: "แสดงความคิดเห็น", feature: "เสนอฟีเจอร์",
  good: "ชอบเลย", bad: "มีบางอย่างผิดปกติ",
  messagePlaceholder: "บอกเราว่าเกิดอะไรขึ้นหรือคุณต้องการอะไร…",
  emailPlaceholder: "อีเมล (ไม่บังคับ หากต้องการคำตอบ)",
  attach: "แนบภาพหน้าจอ", remove: "ลบ", send: "ส่ง", sending: "กำลังส่ง…",
  thanks: "ขอบคุณ! เราได้รับความคิดเห็นของคุณแล้ว", thanksNumber: "หมายเลขอ้างอิง #{n}",
  roadmap: "ดูแผนงาน", close: "ปิด", back: "ย้อนกลับ",
  error: "ส่งความคิดเห็นไม่สำเร็จ กรุณาลองอีกครั้ง",
  screenshotError: "จับภาพหน้าจอไม่สำเร็จ คุณสามารถแนบไฟล์ภาพแทนได้",
};

const BASE: Record<string, Strings> = { en, es, fr, de, it, pt, nl, sv, pl, cs, ro, el, uk, ru, tr, ar, hi, zh, ja, ko, vi, id, th };
const VARIANTS: Record<string, Partial<Strings>> = { "pt-PT": ptPT };

export function baseOf(code: string): string {
  return (code || "").slice(0, 2).toLowerCase();
}

export function isRtl(code: string): boolean {
  return RTL.indexOf(baseOf(code)) !== -1;
}

/** Normalise a BCP-47-ish tag to one of LOCALES (or English). */
export function resolveLang(...candidates: Array<string | null | undefined>): string {
  for (const raw of candidates) {
    if (!raw || raw === "auto") continue;
    const c = raw.replace("_", "-");
    const exact = LOCALES.find((l) => l.toLowerCase() === c.toLowerCase());
    if (exact) return exact;
    const base = baseOf(c);
    const first = LOCALES.find((l) => l.slice(0, 2) === base);
    if (first) return first;
  }
  return DEFAULT_LANG;
}

export function stringsFor(lang: string): Strings {
  const base = BASE[baseOf(lang)] || en;
  const variant = VARIANTS[lang];
  return variant ? { ...en, ...base, ...variant } : { ...en, ...base };
}

export function format(s: string, vars: Record<string, string | number>): string {
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}
