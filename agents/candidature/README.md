# Agente per candidature

Imported records and configuration of the existing candidature workflow.

- `candidate-profile.md`: confirmed candidate facts and preferences.
- `applications.jsonl`: application ledger used to prevent duplicate submissions.
- `reports/`: reports, cover letters and confirmation evidence.
- `output/pdf/`: CV files; the current selected CV is specified in the profile.
- `automation.snapshot.toml`: snapshot of the existing schedule, prompt and target chat.

The active scheduler still uses `C:/Users/miura/Documents/ChatGPT/mediakit sender`. This copy is not automatically synchronized. Do not start a second sender or replay entries from the copied ledger. Before moving the active workflow here, reconcile any newer original records and update the existing automation's paths through the scheduler.

Migration does not change the sender, submission limits, application priorities, approvals, or notification preferences. No applications were sent as part of repository creation.
