import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Debug: Check if environment variables are loaded
console.log("=== Environment Variables Debug ===");
console.log("import.meta.env:", import.meta.env);
console.log("VITE_ANTHROPIC_API_KEY:", import.meta.env.VITE_ANTHROPIC_API_KEY);
console.log("VITE_ANTHROPIC_MODEL:", import.meta.env.VITE_ANTHROPIC_MODEL);
console.log("VITE_ANTHROPIC_BASE_URL:", import.meta.env.VITE_ANTHROPIC_BASE_URL);
console.log("===================================");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
