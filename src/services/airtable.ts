// src/services/airtable.ts
import Airtable from "airtable";

const apiKey = import.meta.env.VITE_AIRTABLE_TOKEN;
const baseId = import.meta.env.VITE_AIRTABLE_BASE_ID;

if (!apiKey || !baseId) {
  throw new Error('Missing Airtable environment variables');
}

const base = new Airtable({ apiKey }).base(baseId);
export default base;