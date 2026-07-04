const API_URL = import.meta.env.VITE_API_URL;

export async function getActivePlayers() {
  const response = await fetch(
    `${API_URL}/api/players/active`
  );

  if (!response.ok) {
    throw new Error("Failed to load players");
  }

  return response.json();
}