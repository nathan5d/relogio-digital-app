// src/components/InstallPWAButton.tsx
import React, { useEffect, useState } from "react";

const InstallPWAButton: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    // 1️⃣ Ouvimos o evento 'beforeinstallprompt'
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault(); // evita o prompt automático
      setDeferredPrompt(event); // salva o evento para uso posterior
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    // 2️⃣ Detecta se já está instalado (Chrome / iOS)
    const checkInstalled = () => {
      if (window.matchMedia("(display-mode: standalone)").matches) {
        setIsInstalled(true);
      } else if ((navigator as any).standalone) {
        setIsInstalled(true);
      }
    };

    checkInstalled();

    window.addEventListener("appinstalled", () => setIsInstalled(true));

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, []);

  // 3️⃣ Função de clique no botão
  const handleInstallClick = async () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const choiceResult = await deferredPrompt.userChoice;

    if (choiceResult.outcome === "accepted") {
      console.log("Usuário aceitou instalar o app");
    } else {
      console.log("Usuário recusou a instalação");
    }

    setDeferredPrompt(null);
  };

  // 4️⃣ Só mostra o botão se o app não estiver instalado e o prompt existir
  if (isInstalled || !deferredPrompt) return null;

  return (
    <button
      onClick={handleInstallClick}
      style={{
        position: "fixed",
        bottom: "1.5rem",
        right: "1.5rem",
        backgroundColor: "#000",
        color: "#fff",
        padding: "0.8rem 1.2rem",
        borderRadius: "1rem",
        border: "none",
        boxShadow: "0 4px 8px rgba(0,0,0,0.25)",
        cursor: "pointer",
      }}
    >
      📲 Instalar App
    </button>
  );
};

export default InstallPWAButton;
