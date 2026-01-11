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
  "What policy change would most reduce urban congestion without harming small businesses?",
  "Design a low-cost experiment to test if AI teammates improve creativity in product teams.",
  "What are the strongest arguments against building data centers in space?",
  "Propose a governance framework for AI debate systems used in public policy.",
];

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
  const [code, setCode] = useState("");
  const [codeRequired, setCodeRequired] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();
  const [creditAmount, setCreditAmount] = useState("");
  const [creditsStatus, setCreditsStatus] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
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

  async function refreshUser() {
    if (!email || !signedIn) return;
    const headers = await getAuthHeader();
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

  async function getAuthHeader() {
    if (!signedIn) {
      console.log("[auth] getAuthHeader: not signed in");
      return {};
    }
    try {
      const session = await fetchAuthSession();
      const idToken = session.tokens?.idToken?.toString();
      if (!idToken) throw new Error("no_token");
      console.log("[auth] getAuthHeader: token acquired", idToken.slice(0, 16), "len", idToken.length);
      setToken(idToken);
      localStorage.setItem("authToken", idToken);
      return { Authorization: `Bearer ${idToken}` };
    } catch {
      console.log("[auth] getAuthHeader: token missing");
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
      console.log("[auth] finishSignIn: token from legacy session", idToken.slice(0, 16));
    }
    if (idToken) {
      console.log("[auth] finishSignIn: token acquired", idToken.slice(0, 16));
      setToken(idToken);
      localStorage.setItem("authToken", idToken);
    } else {
      console.warn("[auth] finishSignIn: token missing");
    }
    console.log("[auth] finishSignIn: signed in", {
      email: user?.signInDetails?.loginId || user?.username || email,
      hasToken: !!idToken,
    });
    setSignedIn(true);
    setShowAuthModal(false);
    setCodeRequired(false);
    await refreshUser();
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

    setAuthStatus("Creating your account...");
    try {
      console.log("[auth] signUp: starting", trimmed);
      await signUp({
        username: trimmed,
        password: generatePassword(),
        attributes: { email: trimmed },
      });
      console.log("[auth] signUp: success", trimmed);
    } catch (err) {
      console.log(err);
      if (err?.code !== "UsernameExistsException") {
        setAuthStatus("Failed to create account.");
        return;
      }
    }

    setAuthStatus("Signing you in...");
    try {
      console.log("[auth] signIn: starting", trimmed);
      const newUser = await signIn({
        username: trimmed,
        options: {
          authFlowType: 'CUSTOM_WITHOUT_SRP',
        },
      });
      console.log("[auth] signIn: response", {
        isSignedIn: newUser?.isSignedIn,
        nextStep: newUser?.nextStep?.signInStep,
      });
      if (newUser?.nextStep?.signInStep === "CONFIRM_SIGN_IN_WITH_CUSTOM_CHALLENGE") {
        console.log("[auth] signIn: custom challenge requires code");
        setAuthStatus("Enter the code sent to your email.");
        setCodeRequired(true);
        setPendingUser(newUser);
        return;
      }
      if (newUser?.isSignedIn) {
        const confirmedUser = await getCurrentUser();
        await finishSignIn(confirmedUser);
        return;
      }
      console.log("[auth] signIn: unexpected nextStep", newUser?.nextStep?.signInStep);
      setAuthStatus("Failed to sign in.");
      return;
    } catch (err) {
      console.log(err);
      setAuthStatus("Failed to sign in.");
      return;
    }
  }

  async function verifyCode() {
    if (!code) {
      return;
    }
    try {
      console.log("[auth] confirmSignIn: manual code submit");
      await confirmSignIn({
        challengeResponse: code.trim(),
      });
      const user = await getCurrentUser();
      await finishSignIn(user);
    } catch {
      setAuthStatus("Invalid code.");
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
    if (requestCount > 0 && creditsUsd <= 0) {
      navigate("/credits");
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
    console.log("[stream] auth header present", Boolean(headers.Authorization));
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

    console.log("[stream] response", resp.status, resp.statusText);
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

  function stopStreaming() {
    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
      streamAbortRef.current = null;
    }
    setIsStreaming(false);
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
        await refreshUser();
        await checkPurchaseStatus();
      } catch {
        console.log("[auth] initAuth: no current user");
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
            <div className="dropdown" id="userMenu">
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
                <button type="button" onClick={handleSignOut}>
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="shell">
        <aside className="panel sidebar">
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
                  onClick={() => selectConversation(item.debate_id)}
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
                      {status ? <span className="status">{status}</span> : null}
                    </div>
                  </>
                ) : (
                  <div className="actions">
                    <button type="button" className="secondary" onClick={stopStreaming}>
                      Stop
                    </button>
                  </div>
                )}
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
          <h3>Welcome to the LLM Salon</h3>
          <p className="lead">
            A structured space for multiple AI models to explore ideas, find disagreements,
            and synthesize better answers together.
          </p>
          <img src="/landing-modal.png" alt="LLM Salon" />
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            placeholder="you@domain.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
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
              />
              <div className="status">
                We sent a one-time code. Enter it to continue.
              </div>
            </>
          )}
          <div className="status">{authStatus}</div>
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
      </div>
    </>
  );
}
