async function testApi() {
  try {
    const res = await fetch('https://bsg-cbt-backend.onrender.com/api/attempts/live-debug');
    const text = await res.text();
    console.log("API Response:", res.status);
    console.log(text.substring(0, 200));
  } catch (e) {
    console.error("Error:", e.message);
  }
}
testApi();
