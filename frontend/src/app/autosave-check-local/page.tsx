"use client";

import { useState } from "react";
import { useAutoSave } from "@/hooks/useAutoSave";

export default function AutoSaveCheck() {
  const [text, setText] = useState("initial");
  const [savedText, setSavedText] = useState("initial");
  const [saving, setSaving] = useState(false);
  const [count, setCount] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const [fail, setFail] = useState(false);
  const [status, setStatus] = useState("Prêt");
  const autosave = useAutoSave({
    scope: "local-check",
    blocked: blocked || saving,
    isDirty: () => text !== savedText,
    onSave: async () => {
      setSaving(true);
      setCount((current) => current + 1);
      setStatus("Enregistrement");
      try {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        if (fail) {
          setStatus("Échec réseau");
          return false;
        }
        setSavedText(text);
        setStatus("Sauvegardé");
        return true;
      } finally {
        setSaving(false);
      }
    },
  });
  return <main style={{ padding: 32 }}>
    <h1>Vérification locale de sauvegarde</h1>
    <label>Contenu <input value={text} onChange={(event) => setText(event.target.value)} /></label>
    <button onClick={() => autosave.setInterval(5)}>Intervalle 5 secondes</button>
    <button onClick={() => autosave.setEnabled(!autosave.enabled)}>Actif : {String(autosave.enabled)}</button>
    <button onClick={() => setBlocked(!blocked)}>Bloqué : {String(blocked)}</button>
    <button onClick={() => setFail(!fail)}>Échec : {String(fail)}</button>
    <button onClick={() => autosave.setInterval(20)}>Rétablir 20 secondes</button>
    <p>État : {status}</p>
    <p>Enregistré : {savedText}</p>
    <p>Requêtes : {count}</p>
    <p>Intervalle : {autosave.interval}</p>
    <p>Prochaine sauvegarde : {autosave.secondsUntilNextSave}</p>
    <p>Modifié : {String(text !== savedText)}</p>
  </main>;
}
