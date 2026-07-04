export default {
  async fetch(request: Request) {

    return new Response(
      JSON.stringify({
        status: "ok"
      }),
      {
        headers: {
          "Content-Type": "application/json"
        }
      }
    )
  }
}