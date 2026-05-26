const send = (msg) =>
    new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));

const openInNewTab = (url) => chrome.tabs.create({ url });

const openReplays = async (tab) => {
    const { ok, endpoint } = await send({ type: 'getKarabuddyEndpoint' });
    if (!ok || !endpoint) return;
    await openInNewTab(`${endpoint}/replays?tab=${encodeURIComponent(tab)}`);
    window.close();
};

document.getElementById('open-mine').addEventListener('click', () => openReplays('mine'));
document.getElementById('open-public').addEventListener('click', () => openReplays('public'));
document.getElementById('open-solo').addEventListener('click', async () => {
    await openInNewTab(chrome.runtime.getURL('options.html'));
    window.close();
});
