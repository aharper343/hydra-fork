param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("claude", "gemini", "codex")]
  [string]$Agent,
  [string]$Url = $(if ($env:AI_ORCH_URL) { $env:AI_ORCH_URL } else { "http://127.0.0.1:4173" }),
  [int]$PollIntervalMs = 1200
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Use cwd as the project directory (set by the launcher)
$repoPath = (Get-Location).Path

# ── ANSI Color Setup ─────────────────────────────────────────────────────────
$ESC = [char]27
$RESET   = "$ESC[0m"
$BOLD    = "$ESC[1m"
$DIM     = "$ESC[90m"
$RED     = "$ESC[91m"
$GREEN   = "$ESC[92m"
$YELLOW  = "$ESC[93m"
$MAGENTA = "$ESC[95m"
$CYAN    = "$ESC[96m"

$AgentColors = @{
  claude = $MAGENTA
  gemini = $CYAN
  codex  = $GREEN
}

$AgentIcons = @{
  claude = [char]0x2666  # ♦
  gemini = [char]0x2726  # ✦
  codex  = [char]0x25B6  # ▶
}

$AgentTaglines = @{
  claude = "Architect $([char]0x00B7) Planner $([char]0x00B7) Coordinator"
  gemini = "Analyst $([char]0x00B7) Critic $([char]0x00B7) Reviewer"
  codex  = "Implementer $([char]0x00B7) Builder $([char]0x00B7) Executor"
}

$Color = $AgentColors[$Agent]
$Icon  = $AgentIcons[$Agent]

try {
  $Host.UI.RawUI.WindowTitle = "Hydra Head - $($Agent.ToUpper())"
} catch {
  # ignore
}

function Get-HydraHeaders {
  $headers = @{
    "Accept" = "application/json"
  }

  if ($env:AI_ORCH_TOKEN) {
    $headers["x-ai-orch-token"] = $env:AI_ORCH_TOKEN
  }

  return $headers
}

function Invoke-HydraGet {
  param([string]$Route)
  return Invoke-RestMethod -Method Get -Uri "$Url$Route" -Headers (Get-HydraHeaders) -TimeoutSec 5
}

function Invoke-HydraPost {
  param(
    [string]$Route,
    [hashtable]$Body
  )

  $json = $Body | ConvertTo-Json -Depth 8
  return Invoke-RestMethod -Method Post -Uri "$Url$Route" -Headers (Get-HydraHeaders) -Body $json -ContentType "application/json" -TimeoutSec 10
}

function Build-HandoffPrompt {
  param($Handoff)

  $summary = [string]$Handoff.summary
  $nextStep = [string]$Handoff.nextStep
  $from = [string]$Handoff.from
  $id = [string]$Handoff.id

return @"
Hydra handoff id: $id
From: $from
Summary: $summary
Next step: $nextStep

Work this now. Ask follow-up questions in this terminal if needed.
If cross-head discussion is needed, run:
npm run hydra:council -- prompt="Council request from $($Agent): <question or conflict>" rounds=2
"@
}

function Start-AgentSession {
  param([string]$Prompt)

  switch ($Agent) {
    "claude" {
      & claude $Prompt
      break
    }
    "gemini" {
      & gemini --prompt-interactive $Prompt
      break
    }
    "codex" {
      & codex $Prompt
      break
    }
    default {
      throw "Unsupported agent: $Agent"
    }
  }
}

# ── Branded Startup ──────────────────────────────────────────────────────────
Write-Output ""
Write-Output "  ${Color}${Icon} $($Agent.ToUpper())${RESET}"
Write-Output "  ${DIM}$($AgentTaglines[$Agent])${RESET}"
Write-Output "  ${Color}$([string]::new([char]0x2500, 42))${RESET}"
Write-Output "  ${DIM}Listening on ${RESET}$Url"
Write-Output "  ${DIM}Project: ${RESET}$repoPath"
Write-Output "  ${DIM}Press Ctrl+C to close${RESET}"
Write-Output ""

$lastNoticeKey = ""

while ($true) {
  try {
    $nextResponse = Invoke-HydraGet -Route "/next?agent=$Agent"
    $next = $nextResponse.next
    $action = [string]$next.action

    if ($action -eq "pickup_handoff" -and $next.handoff) {
      $handoff = $next.handoff
      $handoffId = [string]$handoff.id
      $promptText = Build-HandoffPrompt -Handoff $handoff

      Invoke-HydraPost -Route "/handoff/ack" -Body @{
        handoffId = $handoffId
        agent = $Agent
      } | Out-Null

      Write-Output ""
      Write-Output "  ${Color}${Icon}${RESET} ${BOLD}Picked up handoff ${YELLOW}$handoffId${RESET} ${DIM}$([char]0x2192) launching session...${RESET}"
      Start-AgentSession -Prompt $promptText
      Write-Output "  ${DIM}Session exited. Returning to listen mode...${RESET}"

      $lastNoticeKey = ""
    } elseif ($action -eq "continue_task" -and $next.task) {
      $taskId = [string]$next.task.id
      $key = "continue:$taskId"
      if ($key -ne $lastNoticeKey) {
        Write-Output "  ${Color}${Icon}${RESET} Continue task ${BOLD}$taskId${RESET} ${DIM}($($next.task.title))${RESET}"
        $lastNoticeKey = $key
      }
    } elseif ($action -eq "idle") {
      if ($lastNoticeKey -ne "idle") {
        Write-Output "  ${DIM}${Icon} Waiting for new handoff...${RESET}"
        $lastNoticeKey = "idle"
      }
    } else {
      $lastNoticeKey = ""
    }
  } catch {
    Write-Output "  ${RED}[error]${RESET} ${DIM}$($_.Exception.Message)${RESET}"
    $lastNoticeKey = ""
    Start-Sleep -Milliseconds 1500
  }

  Start-Sleep -Milliseconds $PollIntervalMs
}
