import { useEffect } from "react";
import { setToken } from "../api";

const region = "ap-southeast-2";
const userPoolId = "ap-southeast-2_IxQ2VwGbl"; // from your pool
const clientId = "7ethk777ah5lg6lk7qsfur4go5";
const domain = "ap-southeast-2ixq2vwgbl.auth.ap-southeast-2.amazoncognito.com";
const redirectUri = window.location.origin; // e.g. http://localhost:5173

export default function LoginForm({ onLogin }) {
  // Parse token from redirect
  useEffect(() => {
    if (window.location.hash) {
      const params = new URLSearchParams(window.location.hash.slice(1));
      const idToken = params.get("id_token") || params.get("access_token");
      if (idToken) {
        setToken(idToken);
        onLogin?.();
      }
    }
  }, [onLogin]);

  function goLogin() {
    const url = `https://${domain}/login?client_id=${clientId}&response_type=token&scope=openid+email+profile&redirect_uri=${encodeURIComponent(redirectUri)}`;
    window.location.assign(url);
  }

  return (
    <div className="container">
      <h2>Log Analyzer Login</h2>
      <button onClick={goLogin}>Sign in with Cognito</button>
    </div>
  );
}
