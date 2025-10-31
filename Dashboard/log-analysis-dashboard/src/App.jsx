import { useState } from "react";
import LoginForm from "./components/LoginForm";
import UploadForm from "./components/UploadForm";
import SummaryView from "./components/SummaryView";
import MyLogs from "./components/MyLogs";
import { getToken, clearToken } from "./api";
import "./App.css";


const COGNITO_DOMAIN =
  "https://ap-southeast-2ixq2vwgbl.auth.ap-southeast-2.amazoncognito.com"; // ✅ your Hosted UI domain
const CLIENT_ID = "7ethk777ah5lg6lk7qsfur4go5";
// Update these if your domain/client changes
const LOGOUT_REDIRECT = window.location.origin;

const COGNITO_LOGOUT_URL =
  `${COGNITO_DOMAIN}/logout` +
  `?client_id=${CLIENT_ID}` +
  `&logout_uri=${encodeURIComponent(LOGOUT_REDIRECT)}`;

  const logout = "http://localhost:5173/"

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(!!getToken());
  const [logId, setLogId] = useState(null);
  const [page, setPage] = useState("upload"); // upload | summary | mylogs

  function handleLogout() {
    // Clear local app state + token
    clearToken();
    setIsLoggedIn(false);
    setLogId(null);
    setPage("upload");
    // Redirect through Cognito so its cookies/sessions are cleared too
    window.location.href = logout;
  }

  if (!isLoggedIn) {
    return <LoginForm onLogin={() => { setIsLoggedIn(true); setPage("upload"); }} />;
  }

  return (
    <div className="min-h-screen">
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "1rem",
          background: "#1e293b",
          color: "white",
        }}
      >
        <h1 style={{ fontSize: "1.5rem" }}>Log Analyzer</h1>
        <nav style={{ display: "flex", gap: "1rem" }}>
          <button onClick={() => setPage("upload")}>Upload</button>
          <button onClick={() => setPage("summary")} disabled={!logId}>Summary</button>
          <button onClick={() => setPage("mylogs")}>My Logs</button>
          <button onClick={handleLogout} style={{ background: "#dc2626", color: "white" }}>
            Logout
          </button>
        </nav>
      </header>

      <main style={{ padding: "2rem" }}>
        {page === "upload" && (
          <UploadForm
            onUpload={(id) => {
              setLogId(id);
              setPage("summary");
            }}
          />
        )}
        {page === "summary" && logId && <SummaryView logId={logId} />}
        {page === "mylogs" && (
          <MyLogs
            onSelectLog={(id) => {
              setLogId(id);
              setPage("summary");
            }}
          />
        )}
      </main>
    </div>
  );
}
