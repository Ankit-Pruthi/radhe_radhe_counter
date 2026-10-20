
(() => {
  const $ = id => document.getElementById(id);

  const els = {
    shell: $("appShell"),
    count: $("countNumber"),
    limit: $("limitDisplay"),
    fill: $("progressFill"),
    note: $("progressNote"),
    status: $("statusText"),
    pill: $("listeningPill"),
    transcript: $("transcript"),
    mic: $("micBtn"),
    micText: $("micButtonText"),
    hint: $("voiceHint"),
    toast: $("toast"),
    jaapsPerLoop: $("jaapsPerLoop"),
    totalLoops: $("totalLoops"),
    loopProgress: $("loopProgress"),
    overallProgress: $("overallProgress"),
    celebration: $("completionCelebration"),
    loopTrack: $("loopProgressTrack"),
    loopsFill: $("loopsProgressFill"),
    loopPercent: $("loopPercent"),
    sessionFill: $("sessionProgressFill"),
    sessionPercent: $("sessionPercent"),
    sessionTrack: $("sessionProgressTrack")
  };

  let state = {
    jaaps_per_loop: 108,
    total_loops: 5,
    completed_loops: 0,
    current_count: 0,
    current_loop: 1,
    total_count: 0,
    total_target: 540,
    all_completed: false
  };

  let celebrationArmed = false;
  let lastRenderedCompletedLoops = null;
  let recognition = null;
  let listening = false;
  let toastTimer = null;
  let previousState = null;
  let celebrationShown = false;

  // Serializes all count-changing API calls.
  let actionQueue = Promise.resolve();

  // Invalidates queued voice increments after a reset.
  let voiceGeneration = 0;

  // Tracks the number of pairs already counted for each
  // Web Speech API result slot in the current listening session.
  let countedByResultIndex = new Map();

  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  const loopProgressTrack = document.getElementById("loopProgressTrack");

  if (loopProgressTrack) {
    loopProgressTrack.setAttribute("aria-valuemax", state.jaaps_per_loop);
    loopProgressTrack.setAttribute("aria-valuenow", state.current_count);
  }

  async function requestApi(action, extra = {}) {
    const response = await fetch("/api/count", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Something went wrong.");
    }

    const oldState = state;
    state = data;

    // Detect a loop completion from the API response.
    if (
      oldState &&
      data.completed_loops > oldState.completed_loops
    ) {
      showToast(
        data.all_completed
          ? "Radhe Radhe! All loops completed!"
          : `Loop ${oldState.completed_loops + 1} completed!`
      );
    }

    // Celebrate only when this action completes the session.
    if (
      !oldState.all_completed &&
      data.all_completed &&
      !celebrationShown
    ) {
      const overlay = document.getElementById("completionCelebration");

      if (overlay) {
        overlay.hidden = false;
        celebrationShown = true;
      } else {
        console.error(
          "Celebration overlay missing: #completionCelebration"
        );
      }
    }

    render();
    return data;
  }

  function enqueueAction(action, extra = {}) {
    const task = actionQueue.then(() => requestApi(action, extra));

    // Keep the queue usable if a request fails.
    actionQueue = task.catch(error => {
      showToast(error.message);
    });

    return task;
  }

  function enqueueVoiceIncrements(amount, generation) {
    if (amount <= 0) return;

    const task = actionQueue.then(async () => {
      // A reset may have occurred while this task was waiting.
      if (generation !== voiceGeneration) return;

      for (let i = 0; i < amount; i++) {
        if (generation !== voiceGeneration) return;
        if (state.all_completed) return;

        await requestApi("increment");
      }
    });

    actionQueue = task.catch(error => {
      showToast(error.message);
    });

    return task;
  }

  async function loadState() {
    try {
      const response = await fetch("/api/state");
      if (!response.ok) throw new Error("Could not load session.");

      state = await response.json();
      els.jaapsPerLoop.value = state.jaaps_per_loop;
      els.totalLoops.value = state.total_loops;
      render();
      // Do not replay the celebration simply because the page was refreshed.
      celebrationArmed = !state.all_completed;
      lastRenderedCompletedLoops = state.completed_loops;
    } catch (error) {
      showToast(error.message);
    }
  }

  function render() {
    const perLoop = state.jaaps_per_loop;
    const totalTarget = state.total_target;
    const currentCount = state.current_count;
    const totalCount = state.total_count;
    const completedLoops = state.completed_loops;
    const allCompleted = state.all_completed;

    // Current-loop progress is independent of session progress.
    const loopPercent = allCompleted
      ? 100
      : Math.min(100, (currentCount / perLoop) * 100);

    const overallPercent = totalTarget > 0
      ? Math.min(100, (totalCount / totalTarget) * 100)
      : 0;

    // Identify a loop that has just completed.
    const loopJustCompleted =
      lastRenderedCompletedLoops !== null &&
      completedLoops > lastRenderedCompletedLoops;

    if (loopJustCompleted && !allCompleted) {
      showToast(
        `Loop ${completedLoops} completed! Starting loop ${state.current_loop}.`
      );
    }

    // Main counter and current-loop progress.
    els.count.textContent = allCompleted
      ? perLoop.toLocaleString()
      : currentCount.toLocaleString();

    els.limit.textContent = perLoop.toLocaleString();
    els.fill.style.width = `${loopPercent}%`;

    if (els.loopTrack) {
      els.loopTrack.setAttribute("aria-valuemax", perLoop);
      els.loopTrack.setAttribute(
        "aria-valuenow",
        allCompleted ? perLoop : currentCount
      );
      els.loopTrack.classList.toggle(
        "is-complete",
        loopPercent === 100
      );
    }

    if (els.loopPercent) {
      els.loopPercent.textContent = `${Math.round(loopPercent)}%`;
    }

    // Session-wide progress.
    els.loopProgress.textContent =
      `Loops completed: ${completedLoops} / ${state.total_loops}`;

    els.overallProgress.textContent =
      `Overall progress: ${totalCount.toLocaleString()} / ${totalTarget.toLocaleString()}`;

    if (els.loopsFill) {
      els.loopsFill.style.width =
        `${Math.min(100, completedLoops / state.total_loops * 100)}%`;
    }

    if (els.sessionFill) {
      els.sessionFill.style.width = `${overallPercent}%`;
    }

    if (els.sessionPercent) {
      els.sessionPercent.textContent = `${Math.round(overallPercent)}%`;
    }

    if (els.sessionTrack) {
      els.sessionTrack.setAttribute("aria-valuenow", totalCount);
      els.sessionTrack.setAttribute("aria-valuemax", totalTarget);
    }

    // Full-session completion.
    if (allCompleted) {
      els.note.textContent = "Beautiful! All your Jaap loops are complete.";
      document.body.classList.add("goal-reached");
      els.shell.setAttribute("data-goal-reached", "true");

      els.hint.textContent =
        "Your Jaap session is complete. Use Reset Everything to begin again.";

      // Show the celebration only after a new completion transition.
      if (celebrationArmed && els.celebration) {
        els.celebration.hidden = false;
        celebrationArmed = false;
      }
    } else {
      document.body.classList.remove("goal-reached");
      els.shell.setAttribute("data-goal-reached", "false");

      const remaining = perLoop - currentCount;

      els.note.textContent =
        `${remaining.toLocaleString()} ${
          remaining === 1 ? "chant" : "chants"
        } remaining in loop ${state.current_loop}.`;

      els.hint.textContent = listening
        ? "Listening for complete “Radhe Radhe” pairs and voice Reset."
        : "Set your Jaap target and loops, then start listening.";

      // A new or reset session can celebrate its next completion.
      celebrationArmed = true;

      if (els.celebration) {
        els.celebration.hidden = true;
      }
    }

    $("plusBtn").disabled = allCompleted;
    $("minusBtn").disabled = currentCount === 0;

    lastRenderedCompletedLoops = completedLoops;
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("show");

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.classList.remove("show");
    }, 2500);
  }

  function setListeningState(active) {
    listening = active;

    els.mic.classList.toggle("is-listening", active);
    els.mic.setAttribute("aria-pressed", String(active));
    els.pill.classList.toggle("is-listening", active);

    els.status.textContent = active ? "Listening now" : "Microphone off";
    els.micText.textContent = active ? "Stop listening" : "Start listening";

    render();
  }

  // Preserve Devanagari vowel signs and combining marks.
  function normalize(phrase) {
    return phrase
      .replace(/[^\p{L}\p{M}\p{N}\s\u0900-\u097F]/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  // Count only complete phrases. No fragment-based Hindi matching.
  function countChantPairs(phrase) {
    const text = normalize(phrase);

    const hindiPairs = (text.match(/राधे\s+राधे/gu) || []).length;
    const englishPairs = (text.match(/\bradhe\s+radhe\b/gi) || []).length;

    return hindiPairs + englishPairs;
  }

  function isResetCommand(raw) {
    const text = normalize(raw);

    return /(^|\s)reset($|\s)/i.test(text) ||
      /(^|\s)(रीसेट|रिसेट)(\s|$|[।.!?,])/u.test(text);
  }

  // Resets only the active loop.
  async function resetCurrentLoop(source = "manual") {
    // Stop queued voice work from an earlier transcript.
    voiceGeneration++;
    countedByResultIndex.clear();

    try {
      await enqueueAction("reset");
      showToast(source === "voice"
        ? "Voice command: current loop reset."
        : "Current loop reset.");
    } catch (_) {
      // enqueueAction already displays the API error.
    }
  }

  async function resetEverything() {
    voiceGeneration++;
    countedByResultIndex.clear();

    try {
      await enqueueAction("reset_everything");

      celebrationShown = false;

      const overlay = document.getElementById("completionCelebration");
      if (overlay) {
        overlay.hidden = true;
      }

      if (els.celebration) {
        els.celebration.hidden = true;
      }

      document.body.classList.remove("goal-reached");
      celebrationArmed = true;

      showToast("All Jaap and loop progress reset.");
    } catch (_) {
      // enqueueAction already displays the API error.
    }
  }

  function handleFinalTranscript(raw) {
    els.transcript.textContent = `Heard: “${raw.trim()}”`;

    if (isResetCommand(raw)) {
      void resetCurrentLoop("voice");
    }

    // Do not count chants here. The result-slot tracker handles
    // interim and final results together, avoiding duplicate counts.
  }

  function processSpeechResult(result, resultIndex, generation) {
    // Wait until the browser finalizes this speech result.
    if (!result.isFinal) return;

    // Never process the same finalized result slot twice.
    if (countedByResultIndex.has(resultIndex)) return;

    const alternatives = Array.from(result).map(
      item => item.transcript
    );

    // Prefer an alternative containing a complete chant or Reset.
    const best = alternatives.find(text =>
      countChantPairs(text) > 0 || isResetCommand(text)
    ) || alternatives[0] || "";

    // Mark this finalized result as processed.
    countedByResultIndex.set(resultIndex, true);

    if (!best) return;

    if (isResetCommand(best)) {
      handleFinalTranscript(best);
      return;
    }

    const detected = countChantPairs(best);

    if (detected > 0) {
      void enqueueVoiceIncrements(detected, generation);
    }

    els.transcript.textContent = `Heard: “${best.trim()}”`;
  }

  function startListening() {
    if (!SpeechRecognition) {
      showToast("Speech recognition is not supported. Try a recent Chrome or Edge browser.");
      return;
    }

    if (state.all_completed) {
      showToast("All loops are complete. Reset Everything to begin a new session.");
    }

    countedByResultIndex = new Map();
    const generation = voiceGeneration;

    recognition = new SpeechRecognition();
    recognition.lang = "hi-IN";
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.maxAlternatives = 5;

    recognition.onstart = () => setListeningState(true);

    recognition.onresult = event => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        processSpeechResult(event.results[i], i, generation);
      }
    };

    recognition.onerror = event => {
      const messages = {
        "not-allowed": "Microphone permission denied. Allow microphone access in browser settings.",
        "no-speech": "No speech detected. Try again.",
        "audio-capture": "No microphone found. Check your audio input.",
        "network": "Speech recognition needs a network connection."
      };

      showToast(messages[event.error] ||
        `Speech recognition issue: ${event.error}`);
    };

    recognition.onend = () => {
      setListeningState(false);
      recognition = null;
    };

    try {
      recognition.start();
    } catch (_) {
      setListeningState(false);
      showToast("Could not start the microphone. Please try again.");
    }
  }

  // Manual controls use the same backend session as voice counting.
  $("plusBtn").addEventListener("click", () => {
    if (!state.all_completed) {
      void enqueueAction("increment");
    }
  });

  $("minusBtn").addEventListener("click", () => {
    if (state.current_count > 0) {
      void enqueueAction("decrement");
    }
  });

  $("resetBtn").addEventListener("click", () => {
    void resetCurrentLoop();
  });

  $("resetEverythingBtn").addEventListener("click", () => {
    void resetEverything();
  });

  $("saveSettingsBtn").addEventListener("click", async () => {
    const jaapsPerLoop = Number(els.jaapsPerLoop.value);
    const totalLoops = Number(els.totalLoops.value);

    if (
      !Number.isSafeInteger(jaapsPerLoop) ||
      jaapsPerLoop < 1 ||
      !Number.isSafeInteger(totalLoops) ||
      totalLoops < 1
    ) {
      showToast("Enter positive whole numbers for both settings.");
      return;
    }

    try {
      voiceGeneration++;
      countedByResultIndex.clear();

      await enqueueAction("set_settings", {
        jaaps_per_loop: jaapsPerLoop,
        total_loops: totalLoops
      });

      showToast("Jaap settings saved.");
    } catch (_) {
      // enqueueAction already displays the API error.
    }
  });

  els.mic.addEventListener("click", () => {
    if (listening && recognition) {
      recognition.stop();
      setListeningState(false);
    } else {
      startListening();
    }
  });

  // Allow the completion celebration to be dismissed.
  function dismissCelebration() {
    const overlay = document.getElementById("completionCelebration");

    if (overlay && !overlay.hidden) {
      overlay.hidden = true;
    }
  }

  // Close when clicking anywhere on the overlay.
  const celebrationOverlay = document.getElementById("completionCelebration");

  if (celebrationOverlay) {
    celebrationOverlay.addEventListener("click", dismissCelebration);
  }

  // Close when pressing Escape.
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      dismissCelebration();
    }
  });

  loadState();
})();