import React from "react";
import { createRoot } from "react-dom/client";
import { io } from "socket.io-client";
import { App } from "./App";
import "./styles.css";

const socket = io(import.meta.env.DEV ? "http://127.0.0.1:3001" : undefined, {
  transports: ["polling", "websocket"]
});

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App socket={socket} />
  </React.StrictMode>
);
