fetch("http://127.0.0.1:44755/chat/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
        message: "Merhaba",
        model: "gemini-1.5-flash",
        history: []
    })
}).then(async res => {
    const data = await res.json();
    console.log("Chat ID:", data.chat_id);
    const es = require('http').request(`http://127.0.0.1:44755/chat/events/${data.chat_id}`, { method: 'GET' }, (res) => {
        res.on('data', d => console.log(d.toString()));
    });
    es.end();
});
