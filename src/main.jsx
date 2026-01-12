import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
import { BrowserRouter, Route, Routes } from "react-router-dom";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/activity" element={<App />} />
        <Route path="/credits" element={<App />} />
        <Route path="/faq" element={<App />} />
        <Route path="/discussion/:id" element={<App />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
