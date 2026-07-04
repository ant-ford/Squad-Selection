// src/services/airtable.ts
import Airtable from "airtable";

const apiKey = import.meta.env.VITE_AIRTABLE_TOKEN;
const baseId = import.meta.env.VITE_AIRTABLE_BASE_ID;

if (!apiKey || !baseId) {
  console.warn("Using API backend");
}

const base = new Airtable({ apiKey }).base(baseId);
export default base;