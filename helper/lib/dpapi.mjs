// On native Windows, the device token is stored encrypted with DPAPI for the
// current user (the same protection Windows gives saved passwords), through
// PowerShell's SecureString commands. Elsewhere these are never called.

import { execFileSync } from 'node:child_process'

function powershell(script, input) {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    input,
    encoding: 'utf8',
    windowsHide: true,
  }).trim()
}

/** Plain text in, a DPAPI blob (hex) out. */
export function protect(text) {
  return powershell('$s = ConvertTo-SecureString -String ([Console]::In.ReadToEnd().Trim()) -AsPlainText -Force; ConvertFrom-SecureString -SecureString $s', text)
}

/** A DPAPI blob (hex) in, plain text out; null when it cannot be read (another user, another PC). */
export function unprotect(blob) {
  try {
    return powershell(
      '$s = ConvertTo-SecureString -String ([Console]::In.ReadToEnd().Trim()); [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))',
      blob,
    )
  } catch {
    return null
  }
}
