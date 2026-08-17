"use client";

import { FormEvent, useState } from "react";
import { input, primaryButton } from "@/lib/ui";

export default function CreatorForm({ onSubmit }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const [type, setType] = useState("human");

  return (
    <form onSubmit={onSubmit}>
      <label>
        Name
        <input name="name" required style={input} placeholder="Creator or business name" />
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12, marginTop: 12 }}>
        <label>
          Type
          <select name="type" style={input} value={type} onChange={(event) => setType(event.target.value)}>
            <option value="human">Human creator</option>
            <option value="business">Business</option>
            <option value="ai">AI creator</option>
          </select>
        </label>
        <label>
          Primary goal
          <select name="goal" style={input}>
            <option>grow audience</option>
            <option>start monetizing</option>
            <option>increase revenue</option>
            <option>save time creating</option>
            <option>figure out what to create</option>
          </select>
        </label>
        <label>
          Niche
          <input name="niche" style={input} placeholder="gaming / tech / salon / lifestyle" />
        </label>
        <label>
          Tone
          <input name="tone" style={input} placeholder="playful, useful, direct" />
        </label>
      </div>
      {type === "ai" && (
        <label style={{ display: "block", marginTop: 12 }}>
          <input name="adult" type="checkbox" /> This fictional creator is 18 or older.
        </label>
      )}
      <button style={{ ...primaryButton, marginTop: 14 }}>Create workspace</button>
    </form>
  );
}
