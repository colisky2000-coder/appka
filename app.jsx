import { useState, useEffect, useCallback, useRef } from "react";

// ============================================================
// API HELPER
// ============================================================
const API_BASE = window.location.origin.includes("localhost")
  ? "http://localhost:5000"
  : "";

async function api(path, body = null, isFormData = false) {
  const opts = { method: body ? "POST" : "GET" };
  opts.headers = opts.headers || {};
  opts.headers["ngrok-skip-browser-warning"] = "1";
  if (body && !isFormData) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  } else if (body && isFormData) {
    opts.body = body;
  }
  const resp = await fetch(`${API_BASE}/api${path}`, opts);
  return resp.json();
}

// Telegram WebApp — получить реальный user_id и username
function getTelegramUser() {
  try {
    if (window.Telegram?.WebApp?.initDataUnsafe?.user) {
      const u = window.Telegram.WebApp.initDataUnsafe.user;
      return { id: String(u.id), username: u.username || "" };
    }
  } catch {}
  return { id: "0", username: "webapp_user" };
}

const STATUS_EMOJI = {
  "заявка на проверке": "🔍",
  "карта оформлена": "✅",
  "ожидает получения": "📦",
  "ожидает активации": "🔑",
  "карта активирована": "🎉",
};

// ============================================================
// MAIN APP
// ============================================================
export default function App() {
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState("start");
  const [tgUser] = useState(getTelegramUser);
  const userId = tgUser.id;
  const username = tgUser.username;

  // From server
  const [settings, setSettings] = useState({});
  const [orders, setOrders] = useState([]);
  const [savedAge, setSavedAge] = useState(null);     // "под18"/"над18" from sheet
  const [savedPhone, setSavedPhone] = useState(null);

  // Session
  const [offers, setOffers] = useState([]);
  const [selectedIndices, setSelectedIndices] = useState([]);
  const [completedCards, setCompletedCards] = useState([]);
  const [skippedCards, setSkippedCards] = useState([]);
  const [currentCardIndex, setCurrentCardIndex] = useState(null);
  const [currentOfferLink, setCurrentOfferLink] = useState("");
  const [isMoreCards, setIsMoreCards] = useState(false);
  const [ageChoice, setAgeChoice] = useState(null);    // "under18"/"over18" local
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [activeReceiptOrder, setActiveReceiptOrder] = useState(null);
  const [activeResubmitOrder, setActiveResubmitOrder] = useState(null);
  const [lastReferralLink, setLastReferralLink] = useState("");
  const [refBonus, setRefBonus] = useState("400");
  const [toast, setToast] = useState(null);
  const [animating, setAnimating] = useState(false);
  const [linkLoading, setLinkLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const fileRef = useRef(null);
  const receiptRef = useRef(null);
  const resubmitRef = useRef(null);

  // ============================================================
  // INIT — load from server
  // ============================================================
  const [initError, setInitError] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const res = await api("/init", { user_id: userId });
        setSettings(res.settings || {});
        setSavedAge(res.age || null);
        setSavedPhone(res.phone || null);
        if (res.age) {
          setAgeChoice(res.age === "под18" ? "under18" : "over18");
        }
        if (res.has_orders) {
          const ordersRes = await api("/orders", { user_id: userId });
          setOrders(ordersRes.orders || []);
        }
        setInitError(null);
      } catch (e) {
        console.error("Init error:", e);
        setInitError("Не удалось подключиться к серверу. Проверь интернет или открой приложение позже.");
      }
      setLoading(false);
    })();
  }, [userId]);

  const S = (key) => settings[key] || "";

  // ============================================================
  // HELPERS
  // ============================================================
  const goTo = useCallback((s) => {
    setAnimating(true);
    setTimeout(() => { setScreen(s); setAnimating(false); }, 120);
  }, []);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  const refreshOrders = async () => {
    const res = await api("/orders", { user_id: userId });
    setOrders(res.orders || []);
  };

  const hasOrders = orders.length > 0;
  const hasActivated = orders.some(o => o.status === "карта активирована");

  // ============================================================
  // BUSINESS LOGIC
  // ============================================================
  const handleStart = () => {
    if (hasOrders) {
      goTo("cabinet");
    } else if (savedAge || ageChoice) {
      handleLoadOffers(ageChoice || (savedAge === "под18" ? "under18" : "over18"), false);
    } else {
      goTo("age");
    }
  };

  const handleAge = (a) => {
    setAgeChoice(a);
    handleLoadOffers(a, false);
  };

  const handleLoadOffers = async (ageVal, more) => {
    goTo("loading_offers");
    try {
      const res = await api("/offers", { user_id: userId, age: ageVal, more });
      const o = res.offers || [];
      setOffers(o);
      setSelectedIndices([]);
      setCompletedCards([]);
      setSkippedCards([]);
      setIsMoreCards(more);
      if (res.error === "table_error") {
        showToast(res.message || "Нет доступа к таблице. Проверьте настройки.");
        goTo("start");
        return;
      }
      if (o.length === 0) {
        showToast("Все доступные карты уже оформлены!");
        goTo(hasOrders ? "cabinet" : "start");
      } else {
        goTo("select_cards");
      }
    } catch {
      showToast("Ошибка загрузки офферов");
      goTo("start");
    }
  };

  const toggleCard = (idx) => {
    setSelectedIndices(p => p.includes(idx) ? p.filter(i => i !== idx) : [...p, idx]);
  };

  const bonusPercent = () => {
    const n = selectedIndices.length;
    return n >= 3 ? 15 : n === 2 ? 10 : 0;
  };

  const baseSum = () => selectedIndices.reduce((s, i) => s + offers[i].payout, 0);
  const totalSum = () => { const b = baseSum(); return b + b * bonusPercent() / 100; };

  const handleStartEarning = () => {
    if (savedPhone) {
      handleChooseFirst();
    } else {
      goTo("phone");
    }
  };

  const validatePhone = (t) => {
    const d = t.replace(/[\s+\-()]/g, "").replace(/[^\d]/g, "");
    return d.length >= 7 && d.length <= 15;
  };

  const handlePhoneSubmit = () => {
    if (!validatePhone(phoneInput)) {
      setPhoneError("Введите номер от 7 до 15 цифр");
      return;
    }
    setSavedPhone(phoneInput.trim());
    setPhoneError("");
    handleChooseFirst();
  };

  const handleChooseFirst = () => {
    const avail = selectedIndices.filter(i => !completedCards.includes(i) && !skippedCards.includes(i));
    if (avail.length === 1) {
      handleSendOfferLink(avail[0]);
    } else if (avail.length > 1) {
      goTo("choose_first");
    } else {
      goTo("select_cards");
    }
  };

  const handleSendOfferLink = async (idx) => {
    setCurrentCardIndex(idx);
    setLinkLoading(true);
    goTo("offer_link");
    const offer = offers[idx];
    try {
      const res = await api("/get_ref_link", { user_id: userId, offer_id: offer.offer_id, original_link: offer.original_link || "" });
      setCurrentOfferLink(res.link || offer.original_link || "");
    } catch {
      setCurrentOfferLink(offer.original_link || "");
    }
    setLinkLoading(false);
  };

  const handleSkipCard = () => {
    setSkippedCards(p => [...p, currentCardIndex]);
    const avail = selectedIndices.filter(
      i => !completedCards.includes(i) && ![...skippedCards, currentCardIndex].includes(i)
    );
    if (avail.length > 0) handleSendOfferLink(avail[0]);
    else goTo("final");
  };

  const handleScreenshotUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) {
      showToast("Отправьте именно фото!");
      return;
    }
    setSubmitting(true);
    const offer = offers[currentCardIndex];
    const fd = new FormData();
    fd.append("photo", file);
    fd.append("user_id", userId);
    fd.append("username", username);
    fd.append("card_name", offer.name);
    fd.append("payout", String(offer.payout));
    fd.append("phone", savedPhone || "");
    fd.append("age", ageChoice === "under18" ? "под18" : "над18");
    fd.append("ref_link", currentOfferLink || "");

    try {
      await api("/submit_screenshot", fd, true);
      setCompletedCards(p => [...p, currentCardIndex]);
      goTo("screenshot_sent");
    } catch {
      showToast("Ошибка отправки");
    }
    setSubmitting(false);
  };

  const handleNextCard = () => {
    const avail = selectedIndices.filter(i => !completedCards.includes(i) && !skippedCards.includes(i));
    if (avail.length > 0) handleSendOfferLink(avail[0]);
    else goTo("final");
  };

  const handleReceiptUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) {
      showToast("Отправьте фото карты!");
      return;
    }
    setSubmitting(true);
    const o = activeReceiptOrder;
    const fd = new FormData();
    fd.append("photo", file);
    fd.append("user_id", userId);
    fd.append("username", o.username || username);
    fd.append("card_name", o.card_name);
    fd.append("row_number", String(o.row_number));
    fd.append("phone", o.phone || savedPhone || "");

    try {
      await api("/submit_receipt", fd, true);
      showToast("✅ Фото отправлено на проверку!");
      await refreshOrders();
      goTo("cabinet");
    } catch {
      showToast("Ошибка отправки");
    }
    setSubmitting(false);
  };

  const handleResubmitUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) {
      showToast("Отправьте фото!");
      return;
    }
    setSubmitting(true);
    const o = activeResubmitOrder;
    const fd = new FormData();
    fd.append("photo", file);
    fd.append("user_id", userId);
    fd.append("username", o.username || username);
    fd.append("card_name", o.card_name);
    fd.append("payout", String(o.payout));
    fd.append("phone", o.phone || savedPhone || "");
    fd.append("age", savedAge || (ageChoice === "under18" ? "под18" : "над18"));
    fd.append("ref_link", o.ref_link || "");
    fd.append("old_row_number", String(o.row_number));

    try {
      await api("/resubmit_screenshot", fd, true);
      showToast("🔄 Скриншот отправлен заново!");
      await refreshOrders();
      goTo("cabinet");
    } catch {
      showToast("Ошибка отправки");
    }
    setSubmitting(false);
  };

  const handleOrderMore = () => {
    const a = ageChoice || (savedAge === "под18" ? "under18" : "over18");
    if (a) handleLoadOffers(a, true);
    else goTo("age");
  };

  const handleGenReferral = async () => {
    try {
      const res = await api("/referral/create", { user_id: userId });
      setLastReferralLink(res.link || "");
      setRefBonus(res.bonus || "400");
      goTo("referral_link");
    } catch {
      showToast("Ошибка создания ссылки");
    }
  };

  const handleConfirmReceipt = async (order) => {
    // Проверить актуальный статус
    try {
      const res = await api("/check_status", { row_number: order.row_number });
      if (!["карта оформлена", "ожидает получения"].includes(res.status)) {
        showToast("ℹ️ Статус изменился. Обновите ЛК.");
        await refreshOrders();
        return;
      }
    } catch {}
    setActiveReceiptOrder(order);
    goTo("receipt_request");
  };

  const handleCheckScreenshot = async (order) => {
    try {
      const res = await api("/check_status", { row_number: order.row_number });
      if (res.status !== "заявка на проверке") {
        showToast("ℹ️ Статус изменился. Обновите ЛК.");
        await refreshOrders();
        return;
      }
    } catch {}
    setActiveResubmitOrder(order);
    goTo("screenshot_resubmit");
  };

  // ============================================================
  // COMPUTED
  // ============================================================
  const totalActivated = orders.filter(o => o.status === "карта активирована").reduce((s, o) => s + o.payout, 0);
  const cWaitAct = orders.filter(o => o.status === "ожидает активации");
  const cWaitRec = orders.filter(o => ["карта оформлена", "ожидает получения"].includes(o.status));

  // ============================================================
  // RENDER
  // ============================================================
  if (loading) return <LoadingScreen />;

  return (
    <div style={S_app}>
      {toast && <div style={S_toast}>{toast}</div>}
      {submitting && <div style={S_overlay}><div style={S_spinner} /></div>}

      <div style={{ ...S_wrap, opacity: animating ? 0 : 1, transform: animating ? "translateY(6px)" : "none" }}>

        {/* ===== START ===== */}
        {screen === "start" && (
          <Screen>
            <Pad>
              {hasOrders ? (
                <>
                  <H>💻 Личный кабинет подработки</H>
                  <P>Отслеживай задания, статус заявок, выводи заработок.</P>
                  <Divider />
                  <Ps>⚠️ Выводить деньги можно после активации карты.</Ps>
                  <Links settings={settings} />
                  <Btn text="📲 Личный кабинет" onClick={() => { refreshOrders(); goTo("cabinet"); }} primary />
                  <Btn text="👔 Персональный куратор" href={S("curator_link_main")} />
                </>
              ) : (
                <>
                  <H>👋 Привет!</H>
                  <P>Я помогу рассчитать потенциальный заработок на задании с оформлением дебетовых карт.</P>
                  <P>Ответь на пару вопросов, и я сделаю точный расчёт.</P>
                  {initError && <P style={{ color: "#f88", fontSize: 14 }}>{initError}</P>}
                  <Links settings={settings} />
                  <Btn text="🚀 Начать" onClick={handleStart} primary />
                </>
              )}
            </Pad>
          </Screen>
        )}

        {/* ===== AGE ===== */}
        {screen === "age" && (
          <Screen>
            <Pad>
              <Icon>🎂</Icon>
              <H>Сколько тебе лет?</H>
              <div style={S_ageRow}>
                <AgeBtn icon="👶" label="Меньше 18" onClick={() => handleAge("under18")} />
                <AgeBtn icon="🧑" label="Больше 18" onClick={() => handleAge("over18")} />
              </div>
              {hasOrders && <Btn text="📲 Личный кабинет" onClick={() => goTo("cabinet")} />}
            </Pad>
          </Screen>
        )}

        {/* ===== LOADING ===== */}
        {screen === "loading_offers" && (
          <Screen>
            <div style={S_center}><div style={S_spinnerBig} /><p style={S_loadText}>⏳ Загружаю список карт...</p></div>
          </Screen>
        )}

        {/* ===== SELECT CARDS ===== */}
        {screen === "select_cards" && (
          <Screen>
            <Pad>
              <H>{isMoreCards ? "📋 Дополнительные карты" : "Какие карты ты ещё не оформлял?"}</H>
              <div style={S_cards}>
                {offers.map((o, i) => (
                  <button key={i} style={{ ...S_card, ...(selectedIndices.includes(i) ? S_cardSel : {}) }}
                    onClick={() => toggleCard(i)}>
                    <span style={S_check}>{selectedIndices.includes(i) ? "✅" : "☐"}</span>
                    <div style={S_cardInner}>
                      <span style={S_cardName}>{o.name}</span>
                      <span style={S_cardPay}>{o.payout} ₽</span>
                    </div>
                  </button>
                ))}
              </div>
              <Btn text={`⚙️ Готово (${selectedIndices.length})`}
                onClick={() => selectedIndices.length ? goTo("earnings") : showToast("Выбери хотя бы одну карту!")} primary />
              {isMoreCards ? <Btn text="◀️ Назад в ЛК" onClick={() => goTo("cabinet")} />
                : hasOrders && <Btn text="📲 Личный кабинет" onClick={() => goTo("cabinet")} />}
            </Pad>
          </Screen>
        )}

        {/* ===== EARNINGS ===== */}
        {screen === "earnings" && (
          <Screen>
            <Pad>
              <H>⌨️ Потенциальный заработок</H>
              <div style={S_earCard}>
                {selectedIndices.map(i => (
                  <div key={i} style={S_earRow}>
                    <span style={S_earName}>• {offers[i].name}</span>
                    <span style={S_earVal}>{offers[i].payout} ₽</span>
                  </div>
                ))}
                <div style={S_earDiv} />
                <div style={S_earRow}>
                  <span style={S_earLbl}>💳 Базовая сумма</span>
                  <span style={S_earVal}>{baseSum()} ₽</span>
                </div>
                {bonusPercent() > 0 && (
                  <div style={S_earRow}>
                    <span style={{ ...S_earLbl, color: "#5b8def" }}>💼 Бонус +{bonusPercent()}%</span>
                    <span style={{ ...S_earVal, color: "#5b8def" }}>+{(baseSum() * bonusPercent() / 100).toFixed(0)} ₽</span>
                  </div>
                )}
                <div style={S_earDiv} />
                <div style={S_earRow}>
                  <span style={{ fontSize: 16, fontWeight: 700 }}>💰 ИТОГО</span>
                  <span style={{ fontSize: 18, fontWeight: 700, color: "#6ecf6e" }}>{totalSum().toFixed(0)} ₽</span>
                </div>
              </div>
              <Btn text="⚒️ Перейти к заработку" onClick={handleStartEarning} primary />
              <Btn text="◀️ К выбору карт" onClick={() => goTo("select_cards")} />
            </Pad>
          </Screen>
        )}

        {/* ===== PHONE ===== */}
        {screen === "phone" && (
          <Screen>
            <Pad>
              <Icon>📱</Icon>
              <H>Укажите номер телефона</H>
              <P>Введите номер для оформления карты.</P>
              <Ps>⚠️ Указывайте реальный номер — по нему проверим заявку.</Ps>
              <Ps>🔒 Данные не передаются третьим лицам.</Ps>
              <input type="tel" style={S_input} placeholder="+7 999 123 45 67"
                value={phoneInput} onChange={e => { setPhoneInput(e.target.value); setPhoneError(""); }}
                onKeyDown={e => e.key === "Enter" && handlePhoneSubmit()} />
              {phoneError && <p style={S_err}>{phoneError}</p>}
              <Btn text="Продолжить" onClick={handlePhoneSubmit} primary />
              <Btn text="◀️ Назад" onClick={() => goTo("earnings")} />
            </Pad>
          </Screen>
        )}

        {/* ===== CHOOSE FIRST ===== */}
        {screen === "choose_first" && (
          <Screen>
            <Pad>
              <H>Какую карту оформляешь первой?</H>
              <div style={S_cards}>
                {selectedIndices.filter(i => !completedCards.includes(i) && !skippedCards.includes(i)).map(i => (
                  <button key={i} style={S_firstCard} onClick={() => handleSendOfferLink(i)}>
                    <span>{offers[i].name}</span>
                    <span style={S_cardPay}>{offers[i].payout} ₽</span>
                  </button>
                ))}
              </div>
              <Btn text="◀️ Назад" onClick={() => goTo("earnings")} />
            </Pad>
          </Screen>
        )}

        {/* ===== OFFER LINK ===== */}
        {screen === "offer_link" && currentCardIndex !== null && (() => {
          const offer = offers[currentCardIndex];
          const rem = selectedIndices.filter(i => !completedCards.includes(i) && !skippedCards.includes(i));
          const cp = completedCards.length + 1;
          const tc = completedCards.length + rem.length;
          const rs = rem.reduce((s, i) => s + offers[i].payout, 0);
          return (
            <Screen>
              <Pad>
                <div style={S_badge}>📋 Задание ({cp}/{tc})</div>
                <H>🎯 {offer.name}</H>
                {offer.comment && <Ps>ℹ️ {offer.comment}</Ps>}
                {linkLoading ? (
                  <div style={{ ...S_linkBox, opacity: 0.5 }}>⏳ Загрузка ссылки...</div>
                ) : currentOfferLink ? (
                  <a href={currentOfferLink} target="_blank" rel="noreferrer" style={S_linkBox}>🔗 Перейти к оформлению</a>
                ) : (
                  <div style={{ ...S_linkBox, borderColor: "#ef5350", color: "#ef5350" }}>❌ Ссылка недоступна</div>
                )}
                <div style={S_meta}>
                  <div style={S_metaRow}><span>💰 За карту:</span><span style={S_metaVal}>{offer.payout} ₽</span></div>
                  <div style={S_metaRow}><span>💎 За комплект:</span><span style={S_metaVal}>{rs} ₽</span></div>
                </div>
                <div style={S_warn}>⚠️ Оформи заявку только по ссылке выше — иначе выплата не засчитана.</div>
                <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleScreenshotUpload} />
                <Btn text="Оформил. Отправить на проверку" onClick={() => fileRef.current?.click()} primary />
                <Btn text="Не буду оформлять эту карту" onClick={handleSkipCard} />
                <Btn text="👔 Нужна помощь" href={S("curator_link_help")} />
                {hasOrders && <Btn text="📲 Личный кабинет" onClick={() => goTo("cabinet")} />}
              </Pad>
            </Screen>
          );
        })()}

        {/* ===== SCREENSHOT SENT ===== */}
        {screen === "screenshot_sent" && (
          <Screen>
            <Pad>
              <div style={{ fontSize: 56, textAlign: "center", marginBottom: 16 }}>✅</div>
              <H>Скриншот на проверке!</H>
              <P>Обязательно получи карту, иначе выплата не начислена.</P>
              {selectedIndices.filter(i => !completedCards.includes(i) && !skippedCards.includes(i)).length > 0
                ? <Btn text="Следующая карта" onClick={handleNextCard} primary />
                : <Btn text="🎉 Завершить" onClick={() => goTo("final")} primary />}
              <Btn text="📲 Личный кабинет" onClick={() => { refreshOrders(); goTo("cabinet"); }} />
            </Pad>
          </Screen>
        )}

        {/* ===== FINAL ===== */}
        {screen === "final" && (
          <Screen>
            <Pad>
              <div style={{ fontSize: 56, textAlign: "center", marginBottom: 16 }}>🎉</div>
              <H>Отлично!</H>
              <P>Ты оформил {completedCards.length} карт(ы)</P>
              <div style={S_finalTotal}>💰 Заработок: {totalSum().toFixed(0)} ₽</div>
              <Ps>1. Отметь в ЛК, когда получишь карту.</Ps>
              <Ps>2. Отпиши куратору.</Ps>
              <Btn text="📲 Личный кабинет" onClick={() => { refreshOrders(); goTo("cabinet"); }} primary />
              <Btn text="👔 Отписать куратору" href={S("curator_link_final")} />
              <Btn text="🔄 Начать сначала" onClick={() => { setCompletedCards([]); setSkippedCards([]); goTo("start"); }} />
            </Pad>
          </Screen>
        )}

        {/* ===== CABINET ===== */}
        {screen === "cabinet" && (
          <Screen>
            <HeroImg src={S("image_cabinet")} small />
            <Pad>
              <H>📲 Личный кабинет</H>
              {orders.length === 0 ? <P>У вас пока нет заявок.</P> : (
                <>
                  <Divider />
                  <Ps style={{ fontWeight: 600 }}>📋 Ваши заявки:</Ps>
                  {orders.map((o, i) => (
                    <div key={o.row_number} style={S_orderCard}>
                      <div style={S_orderHead}>
                        <span style={{ color: "#5b8def", fontWeight: 700 }}>{i + 1}.</span>
                        {o.ref_link
                          ? <a href={o.ref_link} target="_blank" rel="noreferrer" style={{ color: "#5b8def", textDecoration: "none", fontWeight: 600, fontSize: 14 }}>{o.card_name}</a>
                          : <span style={{ fontWeight: 600, fontSize: 14 }}>{o.card_name}</span>}
                      </div>
                      <div style={S_orderDets}>
                        <span>Выплата: {o.payout} ₽</span>
                        <span>Дата: {o.timestamp}</span>
                        <span style={{ fontWeight: 500, color: "#c0c4d0" }}>
                          {STATUS_EMOJI[o.status] || "📋"} {o.status}
                        </span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                        {o.status === "заявка на проверке" && (
                          <Mini text="📋 Подтвердить оформление" onClick={() => handleCheckScreenshot(o)} />
                        )}
                        {o.status === "карта оформлена" && (
                          <Mini text="🔑 Подтвердить получение" onClick={() => handleConfirmReceipt(o)} />
                        )}
                        {o.status === "ожидает получения" && (
                          <Mini text="🔑 Подтвердить получение" onClick={() => handleConfirmReceipt(o)} />
                        )}
                        {o.status === "ожидает активации" && (
                          <Mini text="🔓 Активировать" href={S("curator_link_activation")} />
                        )}
                      </div>
                    </div>
                  ))}
                  <Divider />
                  <div style={S_summary}>
                    <div style={S_sumRow}><span>💵 ИТОГО к выплате:</span><span style={{ fontWeight: 700, color: "#6ecf6e" }}>{totalActivated} ₽</span></div>
                    <div style={S_sumRow}><span>📊 Ожидают активации:</span><span>{cWaitAct.length} шт. ({cWaitAct.reduce((s, o) => s + o.payout, 0)} ₽)</span></div>
                    <div style={S_sumRow}><span>⏳ Ожидают получения:</span><span>{cWaitRec.length} шт. ({cWaitRec.reduce((s, o) => s + o.payout, 0)} ₽)</span></div>
                  </div>
                </>
              )}
              <Btn text="💸 Вывод средств" onClick={() => goTo("withdrawal")} />
              <Btn text="🔄 Обновить статусы" onClick={async () => { await refreshOrders(); showToast("Обновлено!"); }} />
              <Btn text="📋 Оформить ещё карты" onClick={handleOrderMore} primary />
              {hasActivated && <Btn text="👫 Деньги за друзей" onClick={() => goTo("referral_cabinet")} />}
              <Btn text="⬅️ Назад" onClick={() => goTo("start")} />
            </Pad>
          </Screen>
        )}

        {/* ===== WITHDRAWAL ===== */}
        {screen === "withdrawal" && (
          <Screen>
            <Pad>
              <Icon>💸</Icon>
              <H>Вывод средств</H>
              {totalActivated === 0 ? (
                <><P>💰 К выводу: <b>0 ₽</b></P><Ps>Для выплаты получите и активируйте карты.</Ps></>
              ) : (
                <>
                  <div style={S_withdrawBox}>
                    <span>К выводу:</span>
                    <span style={{ fontSize: 22, fontWeight: 700, color: "#6ecf6e" }}>{totalActivated} ₽</span>
                  </div>
                  <Btn text="📤 Связаться с куратором" href={S("curator_link_withdrawal")} primary />
                </>
              )}
              <Btn text="◀️ Назад в ЛК" onClick={() => goTo("cabinet")} />
            </Pad>
          </Screen>
        )}

        {/* ===== RECEIPT REQUEST ===== */}
        {screen === "receipt_request" && activeReceiptOrder && (
          <Screen>
            <HeroImg src={S("image_receipt_request")} />
            <Pad>
              <H>📸 Подтверждение получения</H>
              <P>Карта: <b>{activeReceiptOrder.card_name}</b></P>
              <P>Сфотографируйте карту. На фото — последние 4 цифры номера.</P>
              <div style={S_warn}>⚠️ Полный номер и CVV НЕ НУЖНЫ.</div>
              <input ref={receiptRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleReceiptUpload} />
              <Btn text="📷 Загрузить фото" onClick={() => receiptRef.current?.click()} primary />
              <Btn text="◀️ Назад в ЛК" onClick={() => goTo("cabinet")} />
            </Pad>
          </Screen>
        )}

        {/* ===== SCREENSHOT RESUBMIT ===== */}
        {screen === "screenshot_resubmit" && activeResubmitOrder && (
          <Screen>
            <Pad>
              <Icon>🔄</Icon>
              <H>Отправить скриншот заново?</H>
              <P>Заявка по карте <b>{activeResubmitOrder.card_name}</b> на проверке.</P>
              <input ref={resubmitRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleResubmitUpload} />
              <Btn text="🔄 Да, отправить заново" onClick={() => resubmitRef.current?.click()} primary />
              <Btn text="◀️ Нет, вернуться" onClick={() => goTo("cabinet")} />
            </Pad>
          </Screen>
        )}

        {/* ===== REFERRAL CABINET ===== */}
        {screen === "referral_cabinet" && (
          <Screen>
            <Pad>
              <Icon>👫</Icon>
              <H>Деньги за друзей</H>
              <P>За каждого друга, выполнившего задание — <b>{S("referral_bonus_amount") || "400"} ₽</b></P>
              <Btn text="🔗 Получить ссылку" onClick={handleGenReferral} primary />
              <Btn text="◀️ Назад в ЛК" onClick={() => goTo("cabinet")} />
            </Pad>
          </Screen>
        )}

        {/* ===== REFERRAL LINK ===== */}
        {screen === "referral_link" && lastReferralLink && (
          <Screen>
            <Pad>
              <Icon>🔗</Icon>
              <H>Ваша ссылка</H>
              <div style={S_refBox}>
                <code style={{ display: "block", fontSize: 12, color: "#5b8def", wordBreak: "break-all", marginBottom: 12, lineHeight: 1.6 }}>
                  {lastReferralLink}
                </code>
                <button style={S_copyBtn} onClick={() => { navigator.clipboard?.writeText(lastReferralLink); showToast("Скопировано!"); }}>
                  📋 Копировать
                </button>
              </div>
              <Ps>📋 Друг переходит → выполняет задание → вам {refBonus} ₽</Ps>
              <Ps>💡 Каждая ссылка — на одного друга.</Ps>
              <Btn text="🔗 Создать ещё" onClick={handleGenReferral} primary />
              <Btn text="◀️ Назад в ЛК" onClick={() => goTo("cabinet")} />
            </Pad>
          </Screen>
        )}
      </div>
    </div>
  );
}

// ============================================================
// SUB-COMPONENTS
// ============================================================
function LoadingScreen() {
  return <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#0e1117" }}>
    <div style={S_spinner} /><p style={{ color: "#8b8fa3", marginTop: 16, fontSize: 14 }}>Загрузка...</p>
  </div>;
}
function Screen({ children }) { return <div style={{ minHeight: "100vh", paddingBottom: 40 }}>{children}</div>; }
function Pad({ children }) { return <div style={{ padding: "20px 20px 0" }}>{children}</div>; }
function H({ children }) { return <h2 style={S_h}>{children}</h2>; }
function P({ children }) { return <p style={{ fontSize: 15, lineHeight: 1.55, color: "#c0c4d0", marginBottom: 10 }} dangerouslySetInnerHTML={typeof children === "string" ? undefined : undefined}>{children}</p>; }
function Ps({ children, style }) { return <p style={{ fontSize: 13, lineHeight: 1.5, color: "#8b8fa3", marginBottom: 6, ...style }}>{children}</p>; }
function Divider() { return <div style={{ height: 1, background: "linear-gradient(90deg, transparent, #2a2d38, transparent)", margin: "16px 0" }} />; }
function Icon({ children }) { return <div style={S_icon}>{children}</div>; }

function HeroImg({ src, small }) {
  return <div style={{ position: "relative", width: "100%", height: small ? 160 : 220, overflow: "hidden" }}>
    <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", ...(small ? { opacity: 0.7 } : {}) }} />
    <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 80, background: "linear-gradient(transparent, #0e1117)" }} />
  </div>;
}

function Links({ settings }) {
  return <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
    <a href={settings.reviews_link} target="_blank" rel="noreferrer" style={S_miniLink}>🛡 Отзывы</a>
    <a href={settings.news_link} target="_blank" rel="noreferrer" style={S_miniLink}>🔑 Новости</a>
  </div>;
}

function AgeBtn({ icon, label, onClick }) {
  return <button style={S_ageBtn} onClick={onClick}>
    <span style={{ fontSize: 32 }}>{icon}</span><span>{label}</span>
  </button>;
}

function Btn({ text, onClick, primary, href }) {
  if (href) return <a href={href} target="_blank" rel="noreferrer" style={{ ...S_btn, ...(primary ? S_btnP : {}), display: "block", textDecoration: "none", textAlign: "center" }}>{text}</a>;
  return <button style={{ ...S_btn, ...(primary ? S_btnP : {}) }} onClick={onClick}>{text}</button>;
}

function Mini({ text, onClick, href }) {
  if (href) return <a href={href} target="_blank" rel="noreferrer" style={{ ...S_mini, textDecoration: "none" }}>{text}</a>;
  return <button style={S_mini} onClick={onClick}>{text}</button>;
}

// ============================================================
// STYLES
// ============================================================
const S_app = { fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", background: "linear-gradient(180deg,#0e1117 0%,#1a1d26 50%,#0e1117 100%)", minHeight: "100vh", color: "#e8eaed", maxWidth: 480, margin: "0 auto", position: "relative" };
const S_wrap = { transition: "opacity .12s ease,transform .12s ease" };
const S_h = { fontSize: 22, fontWeight: 700, marginBottom: 12, lineHeight: 1.3, background: "linear-gradient(135deg,#e8eaed,#a8b4c4)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" };
const S_icon = { width: 64, height: 64, borderRadius: 32, background: "rgba(91,141,239,.12)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, margin: "0 auto 16px", border: "1px solid rgba(91,141,239,.2)" };
const S_spinner = { width: 36, height: 36, border: "3px solid #2a2d38", borderTop: "3px solid #5b8def", borderRadius: "50%", animation: "spin .8s linear infinite" };
const S_spinnerBig = { width: 56, height: 56, border: "4px solid #2a2d38", borderTop: "4px solid #5b8def", borderRadius: "50%", animation: "spin .8s linear infinite", margin: "0 auto" };
const S_center = { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh" };
const S_loadText = { color: "#8b8fa3", marginTop: 20, fontSize: 16 };
const S_toast = { position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", background: "rgba(30,33,42,.95)", border: "1px solid #2a2d38", borderRadius: 12, padding: "12px 24px", color: "#e8eaed", fontSize: 14, zIndex: 9999, backdropFilter: "blur(8px)", boxShadow: "0 8px 32px rgba(0,0,0,.4)" };
const S_overlay = { position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9998 };
const S_miniLink = { color: "#5b8def", fontSize: 13, textDecoration: "none", padding: "6px 12px", background: "rgba(91,141,239,.08)", borderRadius: 8, border: "1px solid rgba(91,141,239,.15)" };
const S_ageRow = { display: "flex", gap: 12, marginBottom: 20 };
const S_ageBtn = { flex: 1, padding: "20px 16px", background: "rgba(255,255,255,.04)", border: "1px solid #2a2d38", borderRadius: 16, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, color: "#e8eaed", fontSize: 15, fontWeight: 500 };
const S_cards = { display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 };
const S_card = { display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", background: "rgba(255,255,255,.03)", border: "1px solid #2a2d38", borderRadius: 12, cursor: "pointer", color: "#e8eaed", textAlign: "left" };
const S_cardSel = { background: "rgba(91,141,239,.1)", borderColor: "#5b8def" };
const S_check = { fontSize: 18, width: 24 };
const S_cardInner = { flex: 1, display: "flex", justifyContent: "space-between", alignItems: "center" };
const S_cardName = { fontSize: 14, fontWeight: 500 };
const S_cardPay = { fontSize: 14, color: "#6ecf6e", fontWeight: 600 };
const S_firstCard = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 18px", background: "rgba(91,141,239,.06)", border: "1px solid rgba(91,141,239,.2)", borderRadius: 12, cursor: "pointer", color: "#e8eaed", width: "100%" };
const S_earCard = { background: "rgba(255,255,255,.03)", border: "1px solid #2a2d38", borderRadius: 16, padding: 20, marginBottom: 20 };
const S_earRow = { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 };
const S_earName = { fontSize: 14, color: "#c0c4d0" };
const S_earVal = { fontSize: 14, color: "#e8eaed", fontWeight: 500 };
const S_earLbl = { fontSize: 14, color: "#8b8fa3" };
const S_earDiv = { height: 1, background: "#2a2d38", margin: "12px 0" };
const S_input = { width: "100%", padding: "14px 16px", background: "rgba(255,255,255,.06)", border: "1px solid #2a2d38", borderRadius: 12, color: "#e8eaed", fontSize: 16, outline: "none", marginBottom: 8, boxSizing: "border-box" };
const S_err = { color: "#ef5350", fontSize: 13, marginBottom: 8 };
const S_badge = { display: "inline-block", padding: "6px 14px", background: "rgba(91,141,239,.12)", borderRadius: 20, fontSize: 13, color: "#5b8def", fontWeight: 500, marginBottom: 12 };
const S_linkBox = { display: "block", padding: "14px 18px", background: "linear-gradient(135deg,rgba(91,141,239,.15),rgba(91,141,239,.08))", border: "1px solid rgba(91,141,239,.3)", borderRadius: 12, color: "#5b8def", textDecoration: "none", fontSize: 15, fontWeight: 600, marginBottom: 16, textAlign: "center" };
const S_meta = { marginBottom: 16 };
const S_metaRow = { display: "flex", justifyContent: "space-between", padding: "8px 0", fontSize: 14, color: "#c0c4d0" };
const S_metaVal = { fontWeight: 600, color: "#6ecf6e" };
const S_warn = { padding: "12px 16px", background: "rgba(255,183,77,.08)", border: "1px solid rgba(255,183,77,.2)", borderRadius: 10, fontSize: 13, color: "#ffb74d", marginBottom: 16, lineHeight: 1.5 };
const S_btn = { width: "100%", padding: "14px 20px", background: "rgba(255,255,255,.06)", border: "1px solid #2a2d38", borderRadius: 12, color: "#c0c4d0", fontSize: 14, fontWeight: 500, cursor: "pointer", marginBottom: 8, textAlign: "center", boxSizing: "border-box" };
const S_btnP = { background: "linear-gradient(135deg,#5b8def,#4a7de0)", borderColor: "#5b8def", color: "#fff", fontWeight: 600 };
const S_mini = { padding: "8px 14px", background: "rgba(91,141,239,.08)", border: "1px solid rgba(91,141,239,.2)", borderRadius: 8, color: "#5b8def", fontSize: 12, fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap" };
const S_orderCard = { background: "rgba(255,255,255,.03)", border: "1px solid #2a2d38", borderRadius: 12, padding: 14, marginBottom: 10 };
const S_orderHead = { display: "flex", alignItems: "center", gap: 8, marginBottom: 8 };
const S_orderDets = { display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: "#8b8fa3" };
const S_summary = { background: "rgba(91,141,239,.06)", border: "1px solid rgba(91,141,239,.15)", borderRadius: 12, padding: 14 };
const S_sumRow = { display: "flex", justifyContent: "space-between", fontSize: 13, color: "#c0c4d0", marginBottom: 6 };
const S_withdrawBox = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: 18, background: "rgba(110,207,110,.08)", border: "1px solid rgba(110,207,110,.2)", borderRadius: 14, marginBottom: 16, fontSize: 15, color: "#c0c4d0" };
const S_finalTotal = { fontSize: 18, fontWeight: 700, color: "#6ecf6e", textAlign: "center", padding: 16, background: "rgba(110,207,110,.08)", borderRadius: 12, marginBottom: 16 };
const S_refBox = { background: "rgba(255,255,255,.04)", border: "1px solid #2a2d38", borderRadius: 12, padding: 16, marginBottom: 16 };
const S_copyBtn = { width: "100%", padding: "10px 16px", background: "rgba(91,141,239,.12)", border: "1px solid rgba(91,141,239,.25)", borderRadius: 8, color: "#5b8def", fontSize: 13, fontWeight: 600, cursor: "pointer" };

// Global CSS
if (typeof document !== "undefined") {
  const s = document.createElement("style");
  s.textContent = `
    @keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
    *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
    body{margin:0;padding:0;background:#0e1117}
    button:hover{filter:brightness(1.1)}button:active{transform:scale(.98)}
    input:focus{border-color:#5b8def!important}a:hover{filter:brightness(1.2)}
    ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:transparent}
    ::-webkit-scrollbar-thumb{background:#2a2d38;border-radius:2px}
  `;
  document.head.appendChild(s);
}
