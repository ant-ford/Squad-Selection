import Airtable from "airtable";

const apiKey = process.env.AIRTABLE_TOKEN!;
const baseId = process.env.AIRTABLE_BASE_ID!;

const base = new Airtable({
  apiKey
}).base(baseId);

export default base;