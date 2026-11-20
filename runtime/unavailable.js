(() => {
  if (window !== window.top || !['https://www.yapin.gg', 'https://yapin.gg'].includes(location.origin)) return;
  if (document.querySelector('#yapmod-client-unavailable')) return;
  const notice = document.createElement('aside');
  notice.id = 'yapmod-client-unavailable';
  notice.setAttribute('role', 'status');
  Object.assign(notice.style, {position: 'fixed', bottom: '16px', left: '16px', zIndex: '2147483647', padding: '12px 16px', borderRadius: '10px', background: '#23242b', color: '#fff', font: '14px system-ui', boxShadow: '0 4px 18px #0004'});
  notice.append('Yapmod could not load the client. ');
  for (const [label, action] of [['Retry', () => location.reload()], ['Dismiss', () => notice.remove()]]) {
    const button = document.createElement('button');
    button.textContent = label;
    button.onclick = action;
    notice.append(button);
  }
  document.body.append(notice);
})();
