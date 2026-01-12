import React, { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Amplify } from "aws-amplify";
import {
  confirmSignIn,
  fetchAuthSession,
  getCurrentUser,
  signIn,
  signOut as amplifySignOut,
  signUp,
} from "aws-amplify/auth";
import config from "./amplifyconfiguration.json";

Amplify.configure(config);

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  "https://fni1phduu2.execute-api.us-west-2.amazonaws.com/prod";

const STREAM_API_BASE =
  import.meta.env.VITE_STREAM_API_BASE ||
  "https://vuqqnn45p46wqy6jv7pgctwsbi0tfgyi.lambda-url.us-west-2.on.aws/";

const RECOMMENDATIONS = [
  "Will India’s neutral stance in U.S.–China tech competition hold through 2030? What breaks it?",
  "Is the theatrical movie release still the best launch strategy for major franchises in 2026?",
  "What are the strongest arguments for and against building data centers in space?",
  "What is Apple’s best strategy to defend iPhone margins if global smartphone demand stalls?",
];

const INSUFFICIENT_CREDITS_MESSAGE =
  "Your credit balance isn't sufficient to cover a full discussion, please purchase additional credits.";

function generatePassword() {
  const base = Math.random().toString(36).slice(2);
  const extra = Math.random().toString(36).slice(2);
  return `LLMSalon!${base}${extra}9`;
}


function formatCurrency(amountCents, currency = "usd") {
  const amount = Number(amountCents) / 100;
  if (!Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount);
}

function formatTimestamp(ts) {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleString();
}
function parseAmountCents(raw) {
  const amount = Number(String(raw).replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(amount)) {
    return null;
  }
  return Math.round(amount * 100);
}

export default function App() {
  const [email, setEmail] = useState(localStorage.getItem("email") || "");
  const [userId, setUserId] = useState(localStorage.getItem("userId") || "");
  const [token, setToken] = useState(localStorage.getItem("authToken") || "");
  const [known, setKnown] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [pendingUser, setPendingUser] = useState(null);
  const [debates, setDebates] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [usageHistory, setUsageHistory] = useState([]);
  const [selectedDebateId, setSelectedDebateId] = useState(null);
  const [creditsUsd, setCreditsUsd] = useState(0);
  const [requestCount, setRequestCount] = useState(0);
  const [turns, setTurns] = useState([]);
  const [summary, setSummary] = useState("");
  const [topic, setTopic] = useState("");
  const [status, setStatus] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [indicatorTop, setIndicatorTop] = useState(null);
  const [authStatus, setAuthStatus] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [code, setCode] = useState("");
  const [codeRequired, setCodeRequired] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();
  const [creditAmount, setCreditAmount] = useState("");
  const [creditsStatus, setCreditsStatus] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const chatRef = React.useRef(null);
  const composerRef = React.useRef(null);
  const topicRef = React.useRef(null);
  const { id: discussionId } = useParams();
  const streamAbortRef = React.useRef(null);

  const recommendationsHidden = useMemo(
    () => topic.trim().length > 0 || turns.length > 0 || !!selectedDebateId,
    [topic, turns.length, selectedDebateId]
  );


  useEffect(() => {
    if (!topicRef.current) return;
    const node = topicRef.current;
    node.style.height = "auto";
    const maxHeight = 260;
    const minHeight = 32;
    const nextHeight = Math.min(Math.max(node.scrollHeight, minHeight), maxHeight);
    node.style.height = `${nextHeight}px`;
    node.style.overflowY = node.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [topic]);


  const showCreditsPage = location.pathname === "/credits";
  const showActivityPage = location.pathname === "/activity";
  const showFaqPage = location.pathname === "/faq";

  useLayoutEffect(() => {
    if (!isStreaming || showCreditsPage) {
      setIndicatorTop(null);
      return;
    }
    if (!chatRef.current) return;
    const chatRect = chatRef.current.getBoundingClientRect();
    if (!composerRef.current) {
      setIndicatorTop(chatRect.height / 2);
      return;
    }
    if (turns.length === 0) {
      setIndicatorTop(chatRect.height / 2);
      return;
    }
    const lastTurn = chatRef.current.querySelector('.turn:last-of-type');
    const composerRect = composerRef.current.getBoundingClientRect();
    const lastRect = lastTurn ? lastTurn.getBoundingClientRect() : chatRef.current.getBoundingClientRect();
    const midpoint = (lastRect.bottom + composerRect.top) / 2;
    setIndicatorTop(midpoint - chatRect.top);
  }, [isStreaming, turns.length, showCreditsPage]);

  useEffect(() => {
    if (!chatRef.current) return;
    const node = chatRef.current;
    requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight;
    });
  }, [turns, summary, isStreaming]);

  useEffect(() => {
    const closeMenu = (event) => {
      if (!event.target.closest("#userMenu")) {
        setDropdownOpen(false);
      }
    };
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, []);

  async function refreshUser(force = false) {
    if (!email) return;
    if (!signedIn && !force) return;
    const headers = await getAuthHeader(force);
    const resp = await fetch(`${API_BASE}/api/user/init`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ email }),
    });
    const data = await resp.json();
    if (resp.ok) {
      setKnown(!!data.known);
      setDebates(data.debates || []);
      setCreditsUsd(data.user ? data.user.credits_usd || 0 : 0);
      setRequestCount(data.user ? data.user.request_count || 0 : 0);
      setPurchases(data.purchases || []);
      setUsageHistory(data.usage || []);
      if (data.user?.user_id) {
        setUserId(data.user.user_id);
        localStorage.setItem("userId", data.user.user_id);
        return data.user.user_id;
      }
    }
    return null;
  }

  async function getAuthHeader(force = false) {
    if (!signedIn && !force) {
      return {};
    }
    try {
      const session = await fetchAuthSession();
      const idToken = session.tokens?.idToken?.toString();
      if (!idToken) throw new Error("no_token");
      setToken(idToken);
      localStorage.setItem("authToken", idToken);
      return { Authorization: `Bearer ${idToken}` };
    } catch {
      return {};
    }
  }

  async function finishSignIn(user) {
    let idToken = null;
    try {
      const session = await fetchAuthSession({ forceRefresh: true });
      idToken = session.tokens?.idToken?.toString() || null;
    } catch {
      // ignore
    }
    if (!idToken && user?.signInUserSession?.idToken?.jwtToken) {
      idToken = user.signInUserSession.idToken.jwtToken;
    }
    if (idToken) {
      setToken(idToken);
      localStorage.setItem("authToken", idToken);
    } else {
    }
    setSignedIn(true);
    setShowAuthModal(false);
    setCodeRequired(false);
    await refreshUser(true);
    await loadConversations();
  }

  async function checkEmail() {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) {
      setAuthStatus("Enter a valid email.");
      return;
    }
    setEmail(trimmed);
    localStorage.setItem("email", trimmed);
    setAuthStatus("");
    setAuthLoading(true);

    const startSignIn = async () => {
      try {
        const newUser = await signIn({
          username: trimmed,
          options: {
            authFlowType: "CUSTOM_WITHOUT_SRP",
          },
        });
        if (newUser?.nextStep?.signInStep === "CONFIRM_SIGN_IN_WITH_CUSTOM_CHALLENGE") {
          setCodeRequired(true);
          setPendingUser(newUser);
          setAuthLoading(false);
          return true;
        }
        if (newUser?.isSignedIn) {
          const confirmedUser = await getCurrentUser();
          await finishSignIn(confirmedUser);
          setAuthLoading(false);
          return true;
        }
        setAuthStatus("Failed to sign in.");
        setAuthLoading(false);
        return true;
      } catch (err) {
        const errorCode = err?.name || err?.code;
        if (errorCode === "UserNotFoundException" || errorCode === "UserNotFound") {
          setAuthLoading(false);
          return false;
        }
        setAuthStatus("Failed to sign in.");
        setAuthLoading(false);
        return true;
      }
    };

    const signInHandled = await startSignIn();
    if (signInHandled) {
      return;
    }

    try {
      await signUp({
        username: trimmed,
        password: generatePassword(),
        attributes: { email: trimmed },
      });
    } catch (err) {
      const errorCode = err?.name || err?.code;
      if (errorCode !== "UsernameExistsException" && errorCode !== "UsernameExists") {
        setAuthStatus("Failed to create account.");
        setAuthLoading(false);
        return;
      }
    }

    setAuthLoading(true);
    await startSignIn();
  }

  async function verifyCode() {
    if (!code) {
      return;
    }
    setAuthStatus("");
    setAuthLoading(true);
    try {
      await confirmSignIn({
        challengeResponse: code.trim(),
      });
      const user = await getCurrentUser();
      await finishSignIn(user);
    } catch {
      setAuthStatus("Invalid code.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function loadConversations() {
    if (!email) return;
    if (!signedIn) {
      return;
    }
    const refreshedId = await refreshUser();
    const effectiveUserId = refreshedId || localStorage.getItem("userId") || userId;
    if (!effectiveUserId) return;
    const headers = await getAuthHeader();
    const resp = await fetch(
      `${API_BASE}/api/debates?user_id=${encodeURIComponent(effectiveUserId)}`,
      { headers }
    );
    const data = await resp.json();
    if (resp.ok) {
      setDebates(data.debates || []);
    }
  }

  async function loadConversation(debateId) {
    if (!debateId) return;
    const refreshedId = await refreshUser();
    const effectiveUserId = refreshedId || localStorage.getItem("userId") || userId;
    if (!effectiveUserId) return;
    const headers = await getAuthHeader();
    const resp = await fetch(
      `${API_BASE}/api/debate?user_id=${encodeURIComponent(
        effectiveUserId
      )}&debate_id=${encodeURIComponent(debateId)}`,
      { headers }
    );
    const data = await resp.json();
    if (!resp.ok) {
      setStatus(data.error || "Failed to load debate.");
      return;
    }
    const loadedTurns = Array.isArray(data.turns) ? data.turns : [];
    const promptTurn = data.topic
      ? [{ speaker: "You", text: data.topic, role: "user" }]
      : [];
    setTurns([...promptTurn, ...loadedTurns]);
    setSummary(data.summary || "");
  }

  async function selectConversation(debateId) {
    setSelectedDebateId(debateId);
    if (location.pathname !== `/discussion/${debateId}`) {
      navigate(`/discussion/${debateId}`);
    }
    await loadConversation(debateId);
  }

  async function runDebate() {
    if (!topic.trim()) {
      setStatus("Please enter a prompt.");
      return;
    }
    if (!email) {
      setShowAuthModal(true);
      return;
    }
    if (!userId) {
      await refreshUser();
      if (!localStorage.getItem("userId")) return;
    }
    if (requestCount > 0 && creditsUsd < 0.1) {
      setStatus(INSUFFICIENT_CREDITS_MESSAGE);
      return;
    }

    setStatus("");
    const promptText = topic.trim();
    const isContinuation = Boolean(selectedDebateId && turns.length > 0);
    if (isContinuation) {
      setTurns((prev) => [...prev, { speaker: "You", text: promptText, role: "user" }]);
    } else {
      setTurns([{ speaker: "You", text: promptText, role: "user" }]);
      setSummary("");
    }
    setIsStreaming(true);
    setTopic("");

    const headers = await getAuthHeader();
    let resp;
    try {
      const controller = new AbortController();
      streamAbortRef.current = controller;
      resp = await fetch(`${STREAM_API_BASE}/api/debate/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        signal: controller.signal,
        body: JSON.stringify({
          ...(isContinuation
            ? { followup: promptText, more: true, debate_id: selectedDebateId }
            : { topic: promptText }),
          user_id: userId || localStorage.getItem("userId") || "",
        }),
      });
    } catch {
      setStatus("Full generation failed.");
      setTurns((prev) => [...prev, { speaker: "System", text: "Full generation failed.", error: true }]);
      setIsStreaming(false);
      return;
    }

    if (!resp.ok || !resp.body) {
      setStatus("Full generation failed.");
      setTurns((prev) => [...prev, { speaker: "System", text: "Full generation failed.", error: true }]);
      setIsStreaming(false);
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let sawError = false;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.type === "delta") {
          setTurns((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.speaker === message.speaker && last.streaming) {
              next[next.length - 1] = {
                ...last,
                text: last.text + message.delta,
              };
              return next;
            }
            return [...next, { speaker: message.speaker, text: message.delta, streaming: true }];
          });
        } else if (message.type === "turn") {
          setTurns((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.speaker === message.turn.speaker && last.streaming) {
              next[next.length - 1] = { ...message.turn, streaming: false };
              return next;
            }
            return [...next, { ...message.turn, streaming: false }];
          });
        } else if (message.type === "final") {
          setSummary(message.summary || "");
          if (typeof message.credits === "number") {
            setCreditsUsd(message.credits);
          }
          if (typeof message.request_count === "number") {
            setRequestCount(message.request_count);
          }
          if (message.debate_id) {
            setSelectedDebateId(message.debate_id);
            if (location.pathname !== `/discussion/${message.debate_id}`) {
              navigate(`/discussion/${message.debate_id}`);
            }
          }
        } else if (message.type === "error") {
          const errorMessage = "Generation failed.";
          setTurns((prev) => [
            ...prev,
            { speaker: "System", text: errorMessage, error: true },
          ]);
          if (message.error === "credits_required") {
            navigate("/credits");
          }
          setStatus("");
          sawError = true;
        }
      }
      if (sawError) break;
    }

    setIsStreaming(false);
    streamAbortRef.current = null;
    await loadConversations();
    await refreshUser();
  }

  async function startCheckout() {
    if (!signedIn) {
      setShowAuthModal(true);
      return;
    }
    const amountCents = parseAmountCents(creditAmount);
    if (!amountCents || amountCents < 500) {
      setCreditsStatus("Enter at least $5.");
      return;
    }
    setCreditsStatus("");
    const headers = await getAuthHeader();
    const resp = await fetch(`${API_BASE}/api/stripe/checkout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify({
        email,
        amount_cents: amountCents,
        success_url: `${window.location.origin}${window.location.pathname}?purchase=success`,
        cancel_url: window.location.href,
      }),
    });
    const data = await resp.json();
    if (!resp.ok || !data.url) {
      setCreditsStatus(
        "Payment setup failed. Please try again, or contact support if it keeps failing."
      );
      return;
    }
    window.location.href = data.url;
  }

  async function checkPurchaseStatus() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("purchase") !== "success") {
      return;
    }
    await refreshUser();
    setStatus("Credits updated.");
    params.delete("purchase");
    const next =
      window.location.pathname + (params.toString() ? `?${params.toString()}` : "");
    window.history.replaceState({}, "", next);
  }

  async function handleSignOut() {
    try {
      await amplifySignOut();
    } catch {
      // ignore
    }
    setSignedIn(false);
    setToken("");
    setKnown(false);
    setPendingUser(null);
    setTurns([]);
    setSummary("");
    setUserId("");
    localStorage.removeItem("authToken");
    localStorage.removeItem("userId");
    localStorage.removeItem("email");
    setShowAuthModal(true);
  }

  useEffect(() => {
    async function initAuth() {
      try {
        const user = await getCurrentUser();
        const userEmail = user?.signInDetails?.loginId || user?.username || email;
        if (userEmail) {
          setEmail(userEmail);
          localStorage.setItem("email", userEmail);
        }
        const session = await fetchAuthSession();
        const idToken = session.tokens?.idToken?.toString();
        if (idToken) {
          setToken(idToken);
          localStorage.setItem("authToken", idToken);
        }
        setSignedIn(true);
        setShowAuthModal(false);
        await refreshUser(true);
        await checkPurchaseStatus();
      } catch {
        setShowAuthModal(true);
      }
    }
    initAuth();
  }, []);

  useEffect(() => {
    if (!signedIn || !userId) return;
    loadConversations();
  }, [signedIn, userId]);

  useEffect(() => {
    if (!discussionId) return;
    setSelectedDebateId(discussionId);
    setTurns([]);
    setSummary("");
    loadConversation(discussionId);
  }, [discussionId]);

  useEffect(() => {
    if (!selectedDebateId) return;
    if (location.pathname !== "/") return;
    loadConversation(selectedDebateId);
  }, [selectedDebateId, location.pathname]);

  return (
    <>
      <div className="topbar">
        <div className="brand">LLM Salon</div>
        <div className="topbar-actions">
          <button
            type="button"
            className="icon-button compact mobile-only"
            aria-label="Toggle discussions sidebar"
            onClick={() => setSidebarOpen((prev) => !prev)}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#000000"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 6h18" />
              <path d="M3 12h18" />
              <path d="M3 18h18" />
            </svg>
          </button>
          <button
            className="secondary"
            type="button"
            onClick={() => {
              if (!signedIn) {
                setShowAuthModal(true);
                return;
              }
              setCreditsStatus("");
              navigate("/credits");
              setDropdownOpen(false);
            }}
          >
            Get credits
          </button>
          {signedIn && (
            <div className="dropdown desktop-only" id="userMenu">
              <button type="button" onClick={() => setDropdownOpen(!dropdownOpen)}>
                {email || "Account"}
              </button>
              <div
                className="dropdown-menu"
                style={{ display: dropdownOpen ? "block" : "none" }}
              >
                <button type="button" onClick={() => { navigate("/activity"); setDropdownOpen(false); }}>
                  Activity
                </button>
                <button type="button" onClick={() => { navigate("/credits"); setDropdownOpen(false); }}>
                  Credits
                </button>
                <button type="button" onClick={() => { navigate("/faq"); setDropdownOpen(false); }}>
                  FAQs
                </button>
                <button type="button" onClick={handleSignOut}>
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div
        className={`mobile-sidebar-backdrop${sidebarOpen ? " show" : ""}`}
        onClick={() => setSidebarOpen(false)}
      />

      <div className="shell">
        <aside className={`panel sidebar${sidebarOpen ? " open" : ""}`}>
          <div className="sidebar-account mobile-only">
            <div className="sidebar-account-title">{email || "Account"}</div>
            <div className="sidebar-account-actions">
              <button
                type="button"
                onClick={() => {
                  navigate("/activity");
                  setSidebarOpen(false);
                }}
              >
                Activity
              </button>
              <button
                type="button"
                onClick={() => {
                  navigate("/credits");
                  setSidebarOpen(false);
                }}
              >
                Credits
              </button>
              <button
                type="button"
                onClick={() => {
                  navigate("/faq");
                  setSidebarOpen(false);
                }}
              >
                FAQs
              </button>
              <button
                type="button"
                onClick={() => {
                  handleSignOut();
                  setSidebarOpen(false);
                }}
              >
                Sign out
              </button>
            </div>
          </div>
          <div className="sidebar-header">
            <h2>Discussions</h2>
            <button
              type="button"
              className="icon-button compact"
              aria-label="New discussion"
              onClick={() => {
                setSelectedDebateId(null);
                setTurns([]);
                setSummary("");
                setTopic("");
                navigate("/");
                setSidebarOpen(false);
              }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#000000"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="icon icon-tabler icons-tabler-outline icon-tabler-edit"
              >
                <path stroke="none" d="M0 0h24v24H0z" fill="none" />
                <path d="M7 7h-1a2 2 0 0 0 -2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2 -2v-1" />
                <path d="M20.385 6.585a2.1 2.1 0 0 0 -2.97 -2.97l-8.415 8.385v3h3l8.385 -8.415" />
                <path d="M16 5l3 3" />
              </svg>
            </button>
          </div>
          <div className="conversation-list">
            {!email || !signedIn ? (
              <div className="status">Sign in to load history.</div>
            ) : debates.length === 0 ? (
              <div className="status">No discussions yet.</div>
            ) : (
              debates.map((item) => (
                <div
                  key={item.debate_id}
                  className={`conversation${item.debate_id === selectedDebateId ? " active" : ""
                    }`}
                  onClick={() => {
                    selectConversation(item.debate_id);
                    setSidebarOpen(false);
                  }}
                >
                  <div className="conversation-title">{item.topic || "Untitled"}</div>
                  <div className="conversation-meta">
                    {item.turn_count || 0} turns
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>

        <main className="panel">
          {showCreditsPage ? (
            <section className="credits-page">
              <button type="button" className="back-link" onClick={() => navigate("/")}>
                <span className="chevron">‹</span>
                Back to chat
              </button>
              <div className="credits-header">
                <div>Credits</div>
              </div>
              <div className="credits-amount">${creditsUsd.toFixed(2)}</div>

              <div className="credits-card">
                <div className="credits-card-title">Add credits</div>
                <div className="credits-note">Credits are dollars. Minimum purchase $5.</div>
                <div className="credits-fee">Taxes may be added to the credit amount.</div>
                <label htmlFor="creditAmount">Amount (USD)</label>
                <input
                  id="creditAmount"
                  type="text"
                  placeholder="Minimum $5"
                  value={creditAmount}
                  onChange={(event) => setCreditAmount(event.target.value)}
                />
                <div className="status">{creditsStatus}</div>
                <div className="credits-actions">
                  <button type="button" onClick={startCheckout}>
                    Add credits
                  </button>
                </div>
              </div>

              <div className="credits-history">
                <div className="credits-card-title">Recent purchases</div>
                {purchases.length === 0 ? (
                  <div className="status">No purchases yet.</div>
                ) : (
                  purchases.map((item, idx) => (
                    <div key={`purchase-${idx}`} className="credits-row compact">
                      <div className="credits-value">
                        {formatCurrency(item.amount_cents, item.currency)}
                      </div>
                      <div className="credits-value">
                        {formatTimestamp(item.created_at)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          ) : showActivityPage ? (
            <section className="activity-page">
              <button type="button" className="back-link" onClick={() => navigate("/")}>
                <span className="chevron">‹</span>
                Back to chat
              </button>
              <div className="credits-header">
                <div>Activity</div>
              </div>
              {(() => {
                const usageByDebate = new Map();
                for (const item of usageHistory) {
                  if (!item.debate_id) continue;
                  if (!usageByDebate.has(item.debate_id)) {
                    usageByDebate.set(item.debate_id, item);
                  }
                }

                const rows = debates.map((debate) => {
                  const usage = usageByDebate.get(debate.debate_id);
                  return {
                    debate_id: debate.debate_id,
                    topic: debate.topic || "Untitled",
                    turns: debate.turn_count || 0,
                    updated_at: debate.updated_at,
                    tokens: usage?.total_tokens || null,
                    cost: usage?.total_cost_usd ?? null,
                  };
                });

                return rows.length === 0 ? (
                  <div className="status">No activity yet.</div>
                ) : (
                  <div className="activity-table">
                    <div className="activity-row header">
                      <div>Thread</div>
                      <div>Updated</div>
                      <div>Turns</div>
                      <div>Tokens</div>
                      <div>Cost</div>
                    </div>
                    {rows.map((row) => (
                      <Link
                        key={`activity-${row.debate_id}`}
                        to={`/discussion/${row.debate_id}`}
                        className="activity-row row-link"
                        onClick={() => {
                          setSelectedDebateId(row.debate_id);
                          setTurns([]);
                          setSummary("");
                        }}
                      >
                        <div className="activity-title">{row.topic}</div>
                        <div className="activity-meta">{formatTimestamp(row.updated_at)}</div>
                        <div className="activity-meta">{row.turns}</div>
                        <div className="activity-meta">{row.tokens ?? "—"}</div>
                        <div className="activity-meta">
                          {row.cost ? `$${row.cost.toFixed(4)}` : "—"}
                        </div>
                      </Link>
                    ))}
                  </div>
                );
              })()}
            </section>
          ) : showFaqPage ? (
            <section className="faq-page">
              <button type="button" className="back-link" onClick={() => navigate("/")}>
                <span className="chevron">‹</span>
                Back to chat
              </button>
              <div className="credits-header">
                <div>FAQs</div>
              </div>
              <div className="faq-list">
                <div className="faq-item">
                  <div className="faq-question">How does pricing work?</div>
                  <div className="faq-answer">
                    Credits are dollars. Each response deducts credits based on token usage for
                    that generation, and you are billed as the models generate answers.
                  </div>
                </div>
                <div className="faq-item">
                  <div className="faq-question">How do I request a credit adjustment or refund?</div>
                  <div className="faq-answer">
                    Email tryllmsalon@gmail.com with your account email.
                  </div>
                </div>
                <div className="faq-item">
                  <div className="faq-question">Why does LLM Salon exist?</div>
                  <div className="faq-answer">
                    A discussion with diverse opinions is a great way to create new ideas. The paradigm of one person talking to one LLM to get subjective answers is highly limiting. Our goal is to use the best LLMs in a new way -- together in an intellectual discussion -- to invent new ideas through debate, critique, and synthesis.
                    Anyone who has spoken to an LLM knows that they can sound confident but be incorrect and shallow. By  move beyond single-model answers by letting diverse models
                    debate, critique, and synthesize so you get clearer tradeoffs and more original
                    ideas.
                  </div>
                </div>
              </div>
            </section>
          ) : (
            <>
              <section className="chat" ref={chatRef}>
                {isStreaming && (
                  <div className="progress-indicator" style={{ top: indicatorTop ?? "50%" }}>
                    <div className="spinner" />
                  </div>
                )}
                {turns.length === 0 ? (
                  null
                ) : (
                  (() => {
                    let nonUserTurn = 0;
                    return turns.map((turn, idx) => {
                      const label =
                        turn.role === "user" ? "Prompt" : `Turn ${++nonUserTurn}`;
                      return (
                        <div
                          key={`${turn.speaker}-${idx}`}
                          className={`turn${turn.error ? " error" : ""}${turn.role === "user" ? " user" : ""}`}
                        >
                          <h3>{`${label} | ${turn.speaker}`}</h3>
                          <div>{turn.text}</div>
                        </div>
                      );
                    });
                  })()
                )
                }
                {summary ? (
                  <div className="turn summary">
                    <h3>Moderator Summary</h3>
                    <div>{summary}</div>
                  </div>
                ) : null}
              </section>

              <section className="composer" ref={composerRef}>
                <div className={`recommendations${recommendationsHidden ? " hidden" : ""}`}>
                  {RECOMMENDATIONS.map((rec) => (
                    <div
                      key={rec}
                      className="recommendation"
                      onClick={() => setTopic(rec)}
                    >
                      {rec}
                    </div>
                  ))}
                </div>
                {!isStreaming ? (
                  <>
                    <div
                      className="composer-input"
                      onClick={(event) => {
                        if (event.target.closest(".send-button")) return;
                        topicRef.current?.focus();
                      }}
                    >
                      <button type="button" className="send-button in-input" onClick={runDebate} aria-label="Send">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="24"
                          height="24"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                          className="icon icon-tabler icons-tabler-filled icon-tabler-circle-arrow-up"
                        >
                          <path stroke="none" d="M0 0h24v24H0z" fill="none" />
                          <path d="M17 3.34a10 10 0 1 1 -14.995 8.984l-.005 -.324l.005 -.324a10 10 0 0 1 14.995 -8.336zm-4.98 3.66l-.163 .01l-.086 .016l-.142 .045l-.113 .054l-.07 .043l-.095 .071l-.058 .054l-4 4l-.083 .094a1 1 0 0 0 1.497 1.32l2.293 -2.293v5.586l.007 .117a1 1 0 0 0 1.993 -.117v-5.585l2.293 2.292l.094 .083a1 1 0 0 0 1.32 -1.497l-4 -4l-.082 -.073l-.089 -.064l-.113 -.062l-.081 -.034l-.113 -.034l-.112 -.02l-.098 -.006z" />
                        </svg>
                      </button>
                      <textarea
                        id="topic"
                        ref={topicRef}
                        value={topic}
                        onChange={(event) => {
                          setTopic(event.target.value);
                          if (status === "Please enter a prompt.") {
                            setStatus("");
                          }
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && !event.shiftKey) {
                            event.preventDefault();
                            runDebate();
                          }
                        }}
                        placeholder="Ask a focused question to kick off the discussion..."
                        maxLength={5000}
                        rows={1}
                      />
                    </div>
                    <div className="actions">
                      {status ? (
                        <span className="status">
                          {status === INSUFFICIENT_CREDITS_MESSAGE ? (
                            <>
                              Your credit balance isn't sufficient to cover a full discussion,
                              please{" "}
                              <button
                                type="button"
                                className="inline-link"
                                onClick={() => navigate("/credits")}
                              >
                                purchase additional credits
                              </button>
                              .
                            </>
                          ) : (
                            status
                          )}
                        </span>
                      ) : null}
                    </div>
                  </>
                ) : null}
              </section>
            </>
          )}
        </main>
      </div>

      <div
        className="modal-backdrop"
        style={{ display: showAuthModal ? "flex" : "none" }}
      >
        <div className="modal">
          <div className="modal-content">
            <div className="modal-left">
              <h3>Welcome to the LLM Salon</h3>
              <p className="lead">
                Salons are meetings of intellectuals to discuss and debate.
              </p>
              <p className="lead">
                The LLM Salon is a meeting of the most capable LLMs. You ask a question, they will work together to answer.
              </p>
              <p className="lead">
                The models critique, refine, and synthesize their ideas together, providing more depth and reducing the sycophancy of any one model.
              </p>
              <p className="lead">
                Your access to an executive team of LLMs is here.
              </p>
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                placeholder="you@domain.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (!codeRequired) {
                      checkEmail();
                    }
                  }
                }}
              />
              {codeRequired && (
                <>
                  <label htmlFor="code" style={{ marginTop: "8px" }}>
                    Verification code
                  </label>
                  <input
                    id="code"
                    type="text"
                    placeholder="Enter code sent to your email"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        if (codeRequired) {
                          verifyCode();
                        }
                      }
                    }}
                  />
                  <div className="status">
                    We sent a one-time code. It may be in your spam folder. Enter it to continue.
                  </div>
                </>
              )}
              {authStatus && <div className="status">{authStatus}</div>}
              {authLoading && (
                <div className="auth-spinner">
                  <div className="spinner" />
                </div>
              )}
              <div className="modal-actions">
                {!codeRequired ? (
                  <button type="button" onClick={checkEmail}>
                    Continue
                  </button>
                ) : (
                  <button type="button" onClick={verifyCode}>
                    Verify
                  </button>
                )}
              </div>
            </div>
            <div className="modal-right">
              <img src="/landing-modal.png" alt="LLM Salon" />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
