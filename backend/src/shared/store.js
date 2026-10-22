// Create once per app, never a process-global singleton. All state is lost on restart.
// Replace this boundary with repositories in A4; do not add database code in A3.
function createStore() {
  return {
    users: new Map(), sessions: new Map(), services: new Map(),
    queueEntries: new Map(), history: new Map(), notifications: new Map(),
  };
}
module.exports = { createStore };
