with open('frontend/static/js/pages/builder.js', 'r') as f:
    lines = f.readlines()

new_aithinkchat = """  const AIThinkChat = (() => {
    let _container = null;
    let _phraseSpan = null;
    let _timerEl = null;
    let _startTime = 0;
    let _timerRaf = null;
    let _phraseInterval = null;
    let _phraseIdx = 0;
    let _isDone = false;

    const _PHRASES = [
      'Planning your layout...',
      'Choosing typography...',
      'Finding the right photos...',
      'Designing the color palette...',
      'Structuring sections...',
      'Crafting animations...',
      'Building responsive layouts...',
      'Setting up navigation...'
    ];

    function _build() {
      _container = document.createElement('div');
      _container.className = 'message ai ai-thinking-minimal';
      
      _container.innerHTML = `
        <div class="message-content" style="display:flex; align-items:center; gap:8px; opacity:0.8;">
          <div class="ai-think-dots" style="display:flex; gap:2px; color:#d4a85a;">
            <span class="dot" style="animation: orbPulse 1.4s infinite ease-in-out both;">.</span>
            <span class="dot" style="animation: orbPulse 1.4s infinite ease-in-out both; animation-delay:0.2s;">.</span>
            <span class="dot" style="animation: orbPulse 1.4s infinite ease-in-out both; animation-delay:0.4s;">.</span>
          </div>
          <span class="ai-think-phrase" style="color:#a1a1aa; font-size:13px; transition: opacity 0.3s ease;">${_PHRASES[0]}</span>
          <span class="ai-think-timer" style="color:#555; font-size:12px; margin-left:auto;">0s</span>
        </div>
      `;

      _phraseSpan = _container.querySelector('.ai-think-phrase');
      _timerEl = _container.querySelector('.ai-think-timer');

      const messages = document.getElementById('messages');
      if (messages) messages.appendChild(_container);

      _startTime = Date.now();
      _isDone = false;
      _tickTimer();
      _startPhrases();
      _scrollDown();
    }

    function _tickTimer() {
      if (_isDone || !_timerEl) return;
      const secs = Math.floor((Date.now() - _startTime) / 1000);
      _timerEl.textContent = `${secs}s`;
      _timerRaf = requestAnimationFrame(() => setTimeout(_tickTimer, 500));
    }

    function _startPhrases() {
      if (_phraseInterval) clearInterval(_phraseInterval);
      _phraseIdx = 0;
      _phraseInterval = setInterval(() => {
        if (_isDone || !_phraseSpan) return;
        _phraseIdx = (_phraseIdx + 1) % _PHRASES.length;
        _phraseSpan.style.opacity = '0';
        setTimeout(() => {
          if (_isDone) return;
          _phraseSpan.textContent = _PHRASES[_PHRASES.length > _phraseIdx ? _phraseIdx : 0];
          _phraseSpan.style.opacity = '1';
        }, 300);
      }, 3000);
    }

    function _ensure() { if (!_container) _build(); }

    function _scrollDown() {
      const sb = document.getElementById('sidebarBody');
      if (sb) sb.scrollTop = sb.scrollHeight;
    }

    function reset() {
      if (_timerRaf) cancelAnimationFrame(_timerRaf);
      if (_phraseInterval) clearInterval(_phraseInterval);
      if (_container && _container.parentNode) _container.parentNode.removeChild(_container);
      _container = null; _phraseSpan = null; _timerEl = null;
      _startTime = 0; _isDone = false; _timerRaf = null; _phraseInterval = null;
    }

    function doneThinking() {
      if (!_container || _isDone) return;
      _isDone = true;
      reset(); 
    }

    function stream(text) {} 
    function noop() {}

    return {
      show: _ensure,
      stream,
      doneThinking,
      reset,
      addPhase: _ensure,
      addWritingRow: _ensure,
      appendCodeChunk: noop,
      addStep: noop,
      updateStep: noop
    };
  })();\n"""

# lines 0-179 (indices 0 to 179) correspond to lines 1 to 180
new_lines = lines[:180] + [new_aithinkchat] + lines[310:]
with open('frontend/static/js/pages/builder.js', 'w') as f:
    f.writelines(new_lines)
print('Done!')
