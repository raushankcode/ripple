// Public workflow contract consumed by CLI, MCP, and AI agents.
export type AgentControlMode = "brainstorm" | "function" | "file" | "task" | "pr";
export type AgentAuditGate = "beforeRiskyEdit" | "afterStaging" | "beforeMerge";
export type AgentRuntimePhaseId =
  | "discover_contract"
  | "plan_before_edit"
  | "approval_gate"
  | "edit_inside_boundary"
  | "audit_after_change"
  | "record_verification"
  | "repair_or_handoff";
export type AgentRuntimeNextPhaseId = AgentRuntimePhaseId | "done";

export type AgentRuntimePhase = {
  id: AgentRuntimePhaseId;
  order: number;
  requiredWhen: string;
  agentAction: string;
  mcpTool?: string;
  cliCommand?: string;
  outputContract?: string;
  must: string[];
  stopIf: string[];
  continueIf: string[];
};

export type AgentWorkflowSummary = {
  protocol: "ripple-agent-workflow";
  version: 1;
  purpose: string;
  loop: string[];
  controlModes: Record<AgentControlMode, string>;
  auditGates: Record<AgentAuditGate, string>;
  policyWorkflow: {
    defaultAgentPath: string;
    policyOnlyPath: string;
    policyDriftPath: string;
  };
  commands: {
    guide: string;
    initializeRepo: string;
    checkReadiness: string;
    installCi: string;
    explainPolicy: string;
    planBeforeEditing: string;
    checkAfterStaging: string;
    checkChangedAgainstBase: string;
    auditCurrentChange: string;
    gateCurrentChange: string;
    recordVerification: string;
    checkApproval: string;
    approveHumanGate: string;
    ciGate: string;
    repairIntentDrift: string;
  };
  mcpTools: {
    workflow: "ripple_get_agent_workflow";
    checkReadiness: "ripple_doctor";
    explainPolicy: "ripple_explain_policy";
    planBeforeEditing: "ripple_plan_context";
    checkAfterStaging: "ripple_check_staged";
    checkChangedAgainstBase: "ripple_check_changed";
    auditCurrentChange: "ripple_audit_change";
    gateCurrentChange: "ripple_gate";
    recordVerification: "ripple_record_verification";
    checkApproval: "ripple_get_approval_status";
    repairIntentDrift: "ripple_repair_intent_drift";
  };
  outputContracts: {
    doctorHeader: "RIPPLE_DOCTOR";
    planHeader: "RIPPLE_AGENT_CONTEXT";
    stagedCheckHeader: "RIPPLE_STAGED_CHECK";
    repairHeader: "RIPPLE_INTENT_DRIFT_REPAIR";
    auditHeader: "RIPPLE_AUDIT";
    gateHeader: "RIPPLE_GATE";
    approvalHeader: "RIPPLE_APPROVAL";
    approvalStatusHeader: "RIPPLE_APPROVAL_STATUS";
    doctorSections: string[];
    planSections: string[];
    stagedCheckSections: string[];
    repairSections: string[];
    auditSections: string[];
    gateSections: string[];
  };
  runtimeContract: {
    protocol: "ripple-agent-runtime-contract";
    version: 1;
    invariant: string;
    compatibleRuntimes: string[];
    sourceOfTruth: string[];
    phases: AgentRuntimePhase[];
    stopConditions: string[];
    proceedConditions: string[];
  };
  rules: string[];
  example: string[];
};

export function getAgentWorkflowSummary(): AgentWorkflowSummary {
  return {
    protocol: "ripple-agent-workflow",
    version: 1,
    purpose: "Give AI coding agents a human-selected trust boundary before editing, then check staged changes for intent drift and boundary drift before handoff.",
    loop: [
      "choose_boundary",
      "plan",
      "approve_if_required",
      "edit",
      "stage",
      "check",
      "record_verification",
      "repair_if_needed",
    ],
    controlModes: {
      brainstorm: "Agent can plan, explain, and suggest, but no file edits are allowed.",
      function: "Agent can edit only the approved symbol or function inside the target file.",
      file: "Agent can edit only the selected target file.",
      task: "Agent can edit the files saved in the task intent.",
      pr: "Agent can prepare a low-risk PR, but human review remains the merge gate.",
    },
    auditGates: {
      beforeRiskyEdit: "Human approval is required before editing human-gated sensitive or dangerous targets.",
      afterStaging: "Ripple checks staged changes against saved intent and selected control boundary.",
      beforeMerge: "Human reviews the diff plus Ripple drift and boundary verdict before merge.",
    },
    policyWorkflow: {
      defaultAgentPath: "Use ripple_plan_context first in MCP; it includes policyExplanation. In CLI, use planBeforeEditing with --json when automation needs the same policyExplanation shape.",
      policyOnlyPath: "Use explainPolicy / ripple_explain_policy only when you need the repo trust boundary without a plan.",
      policyDriftPath: "If checkAfterStaging or repairIntentDrift reports policyDrift.status=changed, stop and ask the human to review the current policy before continuing.",
    },
    commands: {
      guide: "ripple agent",
      initializeRepo: "ripple init",
      checkReadiness: "ripple doctor --agent --strict",
      installCi: "ripple init-ci",
      explainPolicy: "ripple policy explain --file <file> --agent",
      planBeforeEditing: "ripple plan --file <file> --task \"<task>\" --mode file --agent --save",
      checkAfterStaging: "ripple check --staged --agent --intent latest",
      checkChangedAgainstBase: "ripple check --changed --base <ref> --agent --intent latest",
      auditCurrentChange: "ripple audit --agent --intent latest",
      gateCurrentChange: "ripple gate --agent --intent latest",
      recordVerification: "ripple verify --run \"<command>\" --intent latest",
      checkApproval: "ripple approval --intent latest --agent",
      approveHumanGate: "ripple approve --intent latest --gate before-risky-edit",
      ciGate: "ripple ci --base <ref> --github-annotations",
      repairIntentDrift: "ripple repair --agent --intent latest",
    },
    mcpTools: {
      workflow: "ripple_get_agent_workflow",
      checkReadiness: "ripple_doctor",
      explainPolicy: "ripple_explain_policy",
      planBeforeEditing: "ripple_plan_context",
      checkAfterStaging: "ripple_check_staged",
      checkChangedAgainstBase: "ripple_check_changed",
      auditCurrentChange: "ripple_audit_change",
      gateCurrentChange: "ripple_gate",
      recordVerification: "ripple_record_verification",
      checkApproval: "ripple_get_approval_status",
      repairIntentDrift: "ripple_repair_intent_drift",
    },
    outputContracts: {
      doctorHeader: "RIPPLE_DOCTOR",
      planHeader: "RIPPLE_AGENT_CONTEXT",
      stagedCheckHeader: "RIPPLE_STAGED_CHECK",
      repairHeader: "RIPPLE_INTENT_DRIFT_REPAIR",
      auditHeader: "RIPPLE_AUDIT",
      gateHeader: "RIPPLE_GATE",
      approvalHeader: "RIPPLE_APPROVAL",
      approvalStatusHeader: "RIPPLE_APPROVAL_STATUS",
      doctorSections: [
        "status",
        "readiness_decision",
        "enforcement_level",
        "can_guide_agents",
        "can_detect_drift",
        "can_block_in_ci",
        "policy_explicit",
        "graph",
        "git",
        "ci_workflow",
        "latest_intent",
        "gaps",
        "next_steps",
      ],
      planSections: [
        "readiness_status",
        "enforcement_level",
        "can_detect_drift",
        "can_block_in_ci",
        "readiness_gaps",
        "editable_files",
        "control_mode",
        "human_gate",
        "allowed_files",
        "allowed_symbols",
        "context_files",
        "read_first",
        "read_if_needed",
        "symbols_first",
        "verify",
        "avoid_first",
      ],
      stagedCheckSections: [
        "handoff",
        "drift_verdict",
        "drift_decision",
        "next_required_phase",
        "next_required_action",
        "drift_why",
        "drift_fix",
        "boundary_verdict",
        "boundary_decision",
        "boundary_why",
        "boundary_fix",
        "policy_drift",
        "readiness_drift",
        "intent_verdict",
        "control_mode",
        "human_required",
        "planned_scope",
        "allowed_files",
        "allowed_symbols",
        "editable_files",
        "context_files_changed",
        "changed_files",
        "read_first",
        "symbols_first",
        "verify",
      ],
      repairSections: [
        "handoff",
        "drift_verdict",
        "drift_decision",
        "drift_why",
        "drift_fix",
        "boundary_verdict",
        "boundary_decision",
        "boundary_why",
        "boundary_fix",
        "policy_drift",
        "readiness_drift",
        "verdict",
        "status",
        "unstage_files",
        "review_contracts",
        "fix_actions",
        "verify",
        "next_steps",
      ],
      auditSections: [
        "handoff",
        "status",
        "decision",
        "can_proceed",
        "next_required_phase",
        "next_required_action",
        "approval_status",
        "approval_decision",
        "approval_required",
        "approval_approved",
        "approval_gate",
        "intent_id",
        "control_mode",
        "drift_verdict",
        "boundary_verdict",
        "policy_drift",
        "readiness_drift",
        "repair_status",
        "recommended_action",
        "saved_policy_explanation",
        "current_policy_explanation",
        "blocking_reasons",
        "changed_files",
        "verify",
        "fix_actions",
      ],
      gateSections: [
        "status",
        "decision",
        "can_continue",
        "must_stop",
        "needs_human",
        "next_required_phase",
        "next_required_action",
        "audit_status",
        "approval_status",
        "why",
        "fix_now",
        "ask_human",
        "commands_doctor",
        "commands_check",
        "commands_audit",
        "commands_repair",
        "commands_approve",
        "commands_unstage",
        "commands_verify",
      ],
    },
    runtimeContract: {
      protocol: "ripple-agent-runtime-contract",
      version: 1,
      invariant:
        "An agent should edit only after a saved Ripple plan defines the trust boundary, and should proceed only when the Ripple audit says the change can proceed.",
      compatibleRuntimes: [
        "MCP coding agents",
        "CLI-driven coding agents",
        "IDE coding agents",
        "CI and PR bots",
      ],
      sourceOfTruth: [
        "Before editing, ripple_plan_context / ripple plan is the source of truth.",
        "During editing, saved change intent allowed_files and allowed_symbols are the source of truth.",
        "After editing, ripple_audit_change / ripple audit is the full report; ripple gate is the compact continue/stop decision.",
        "After running verification, ripple verify --run records executed evidence; ripple_record_verification records reported evidence from MCP runtimes before final gate.",
        "If human approval is required, ripple_get_approval_status / ripple approval is the source of truth.",
      ],
      phases: [
        {
          id: "discover_contract",
          order: 1,
          requiredWhen: "before any autonomous Ripple-controlled task",
          agentAction: "Load the current Ripple protocol, commands, tools, output headers, and stop rules.",
          mcpTool: "ripple_get_agent_workflow",
          cliCommand: "ripple agent --json",
          outputContract: "ripple-agent-workflow",
          must: [
            "Use the returned versioned protocol for the current repo and session.",
            "Run initializeRepo before the first saved plan when repo setup is missing.",
            "Run checkReadiness before planning or editing when the runtime can execute local commands.",
            "Prefer MCP tools when the runtime has MCP access; otherwise use the CLI commands.",
          ],
          stopIf: [
            "protocol is missing, unsupported, or older than the runtime understands.",
          ],
          continueIf: [
            "protocol=ripple-agent-workflow and version=1.",
          ],
        },
        {
          id: "plan_before_edit",
          order: 2,
          requiredWhen: "before reading broadly or editing a known target file",
          agentAction: "Create a saved plan with task, target file, control mode, policy explanation, and context budget.",
          mcpTool: "ripple_plan_context",
          cliCommand: "ripple plan --file <file> --task \"<task>\" --mode file --agent --save",
          outputContract: "RIPPLE_AGENT_CONTEXT",
          must: [
            "Save the change intent when edits may follow.",
            "Read read_first and symbols_first before changing code.",
            "Treat allowed_files and allowed_symbols as the edit boundary.",
            "Treat policyExplanation as the repo trust-boundary snapshot for this intent.",
          ],
          stopIf: [
            "no target file is known for a file/function boundary task.",
            "the plan cannot be saved but later drift checking is required.",
          ],
          continueIf: [
            "changeIntent exists and editable_files match the intended scope.",
          ],
        },
        {
          id: "approval_gate",
          order: 3,
          requiredWhen: "when human_gate=required-before-edit or policy requires approval",
          agentAction: "Check whether the human approved the saved risky edit gate before changing files.",
          mcpTool: "ripple_get_approval_status",
          cliCommand: "ripple approval --intent latest --agent",
          outputContract: "RIPPLE_APPROVAL_STATUS",
          must: [
            "Do not treat context reading as approval to edit.",
            "Use the approval status for the same saved intent id and gate.",
          ],
          stopIf: [
            "approval status is missing or stale for a required gate.",
            "approval belongs to a different intent, policy snapshot, or gate.",
          ],
          continueIf: [
            "approval is not required, or approvalStatus.approved=true for the saved intent.",
          ],
        },
        {
          id: "edit_inside_boundary",
          order: 4,
          requiredWhen: "after plan and any required approval pass",
          agentAction: "Edit only inside the saved trust boundary and keep context-only files read-only unless replanned.",
          must: [
            "For brainstorm mode, do not edit files.",
            "For function mode, edit only the approved symbols.",
            "For file mode, edit only the selected file.",
            "For task/pr mode, edit only planned editable files.",
          ],
          stopIf: [
            "the task needs a file or symbol outside the saved boundary.",
            "the agent needs to touch a human-gated file that was not approved.",
          ],
          continueIf: [
            "all edits remain inside editable_files and allowed_symbols.",
          ],
        },
        {
          id: "audit_after_change",
          order: 5,
          requiredWhen: "after files are staged, or before handoff in changed-file workflows",
          agentAction: "Run the compact Ripple gate or full audit to detect drift, approval state, and verification targets.",
          mcpTool: "ripple_gate",
          cliCommand: "ripple gate --agent --intent latest",
          outputContract: "RIPPLE_GATE",
          must: [
            "Use staged audit for local agent work and changed audit for PR/CI work.",
            "Use ripple gate when the agent only needs the continue/stop handoff.",
            "Check drift_verdict, boundary_verdict, policy_drift, approval_status, and can_proceed together.",
            "If verification targets exist and the agent runs them, record the result before the final handoff gate.",
          ],
          stopIf: [
            "can_continue=false or can_proceed=false.",
            "policyDrift.status=changed.",
            "drift_verdict or boundary_verdict blocks the change.",
            "approval is required but not approved.",
          ],
          continueIf: [
            "can_continue=true or can_proceed=true and audit status is passed.",
          ],
        },
        {
          id: "record_verification",
          order: 6,
          requiredWhen: "after the agent runs, skips, or cannot prove a verification target from the plan, audit, or gate",
          agentAction: "Record verification evidence on the saved intent, then run the gate again for the final continue/stop decision.",
          mcpTool: "ripple_record_verification",
          cliCommand: "ripple verify --run \"<command>\" --intent latest",
          outputContract: "ripple-verification-evidence",
          must: [
            "Prefer ripple verify --run so Ripple executes the command and records the exit code.",
            "Record passed only when the named command or manual check actually passed.",
            "Record failed when the command failed or produced a blocking result.",
            "Record skipped or unknown when the agent did not run the check or cannot prove the result.",
            "Run gateCurrentChange again after recording verification evidence.",
          ],
          stopIf: [
            "verification status is failed, skipped, or unknown until ripple_gate returns repair or human-review.",
            "the agent cannot name the command or check it is reporting.",
          ],
          continueIf: [
            "verification evidence is recorded and a fresh gate/audit permits continuing.",
          ],
        },
        {
          id: "repair_or_handoff",
          order: 7,
          requiredWhen: "when audit fails, or when preparing final human handoff",
          agentAction: "Ask Ripple for exact repair actions, or hand off the passed audit summary to the human.",
          mcpTool: "ripple_repair_intent_drift",
          cliCommand: "ripple repair --agent --intent latest",
          outputContract: "RIPPLE_INTENT_DRIFT_REPAIR",
          must: [
            "Follow blocker fix_actions before widening scope.",
            "Unstage files Ripple marks as outside intent unless the human explicitly replans or approves wider scope.",
            "Record verification evidence before final handoff when the agent ran, skipped, or could not prove a verification target.",
          ],
          stopIf: [
            "repair status is human-review-required.",
            "the fix requires widening the saved trust boundary.",
          ],
          continueIf: [
            "repair status is no-repair-needed, or repairs are applied and a fresh audit passes.",
          ],
        },
      ],
      stopConditions: [
        "No saved change intent exists for a task that will edit files.",
        "A required human approval is missing or stale.",
        "The agent needs to edit outside allowed_files or allowed_symbols.",
        "policyDrift.status=changed.",
        "drift_verdict or boundary_verdict is DANGER or blocks the change.",
        "Reported verification evidence is failed, skipped, or unknown.",
        "audit.canProceed is false.",
        "repair status is human-review-required.",
      ],
      proceedConditions: [
        "A saved intent exists for the current task.",
        "Human approval is not required, or approvalStatus.approved=true for the current intent and gate.",
        "Edits remain inside editable_files and allowed_symbols.",
        "policyDrift.status is unchanged or not-applicable.",
        "The audit reports canProceed=true.",
        "Recorded verification evidence, when present, is passed; failed, skipped, or unknown evidence requires repair or human review.",
      ],
    },
    rules: [
      "Choose the narrowest control mode before editing: brainstorm, function, file, task, or pr.",
      "Run planBeforeEditing before reading broadly or editing a known target file.",
      "Treat policyExplanation inside planBeforeEditing as the normal source of truth for effective mode, policy risk, matched rules, and human gate.",
      "Treat policyDrift.status=changed as a human-review stop: current repo trust policy differs from the saved intent snapshot.",
      "Call explainPolicy only for policy-only checks when no task plan is needed.",
      "Read read_first files and symbols_first symbols before changing code.",
      "Do not read avoid_first items in the first pass unless the plan forces it.",
      "Save the change intent from planBeforeEditing so staged checks can detect drift.",
      "If the plan reports human_gate=required-before-edit, a human should run approveHumanGate after reviewing the plan and before the agent edits.",
      "Use checkApproval when you need approval state without running the full audit.",
      "Stay inside allowed_files and allowed_symbols unless the human approves a wider boundary.",
      "Run initializeRepo once per repo to create the default trust policy and CI gate.",
      "Run checkReadiness before enabling or debugging CI automation.",
      "Run installCi when GitHub Actions setup is missing.",
      "After editing, stage the intended files and run checkAfterStaging against the saved intent.",
      "Use auditCurrentChange when a human needs one compact report of intent, boundary, policy drift, repair status, and next action.",
      "Use gateCurrentChange when an agent needs only the final continue, repair, human-review, or restore-readiness decision.",
      "After running verification targets, prefer ripple verify --run before the final gate; MCP runtimes may call recordVerification when they can only report evidence.",
      "Do not claim verification passed without recorded passed evidence.",
      "In CI or PR review, use checkChangedAgainstBase instead of staging files.",
      "Use ciGate as the default strict automation command for PR checks.",
      "If staged changes drift from intent or boundary, call repairIntentDrift before widening scope.",
      "Use verify targets as the narrowest compile, test, or caller-review surface.",
    ],
    example: [
      "ripple init",
      "ripple plan --file src/auth.ts --task \"change token refresh behavior\" --mode file --agent --save",
      "ripple approval --intent latest --agent",
      "ripple approve --intent latest --gate before-risky-edit",
      "ripple plan --file src/auth.ts --symbol refreshToken --task \"fix retry behavior\" --mode function --agent --save",
      "git add src/auth.ts",
      "ripple check --staged --agent --intent latest",
      "ripple audit --agent --intent latest",
      "ripple verify --run \"npm test -- tests/auth.test.ts\" --intent latest",
      "ripple gate --agent --intent latest",
      "ripple doctor --agent --strict",
      "ripple check --changed --base origin/main --agent --intent latest",
      "ripple ci --base origin/main --github-annotations",
      "ripple repair --agent --intent latest",
    ],
  };
}
