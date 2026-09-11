param(
  [Parameter(Mandatory=$true)][string]$Executable,
  [Parameter(Mandatory=$true)][string]$VersionResource,
  [Parameter(Mandatory=$true)][string]$Metadata
)
$ErrorActionPreference = "Stop"

# Native resource editing changes product/file metadata, not publisher trust.
# Rebranded copies cannot retain the original vendor's Authenticode signature.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public static class ValidexVersionResources {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern IntPtr LoadLibraryExW(string path, IntPtr file, uint flags);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool FreeLibrary(IntPtr module);
  delegate bool EnumLanguage(IntPtr module, IntPtr type, IntPtr name, ushort language, IntPtr parameter);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool EnumResourceLanguagesW(IntPtr module, IntPtr type, IntPtr name, EnumLanguage callback, IntPtr parameter);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern IntPtr BeginUpdateResourceW(string path, bool deleteExisting);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool UpdateResourceW(IntPtr update, IntPtr type, IntPtr name, ushort language, byte[] data, uint size);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool EndUpdateResourceW(IntPtr update, bool discard);
  [DllImport("imagehlp.dll", SetLastError=true)]
  static extern bool ImageEnumerateCertificates(SafeFileHandle file, ushort filter, out uint count, [Out] uint[] indices, uint indexCount);
  [DllImport("imagehlp.dll", SetLastError=true)]
  static extern bool ImageRemoveCertificate(SafeFileHandle file, uint index);

  static void Check(bool success, string operation) {
    if (!success) throw new Win32Exception(Marshal.GetLastWin32Error(), operation);
  }

  static void RemoveOriginalSignature(string path) {
    using (FileStream stream = new FileStream(path, FileMode.Open, FileAccess.ReadWrite, FileShare.None)) {
      while (true) {
        uint count;
        Check(ImageEnumerateCertificates(stream.SafeFileHandle, 255, out count, null, 0), "Enumerate executable certificates");
        if (count == 0) return;
        if (count > 1024) throw new InvalidDataException("Unexpected certificate count");
        uint[] indices = new uint[count];
        Check(ImageEnumerateCertificates(stream.SafeFileHandle, 255, out count, indices, count), "Read certificate indices");
        Check(ImageRemoveCertificate(stream.SafeFileHandle, indices[0]), "Remove obsolete vendor signature");
      }
    }
  }

  public static void Replace(string path, byte[] resource) {
    path = Path.GetFullPath(path);
    RemoveOriginalSignature(path);
    List<ushort> languages = new List<ushort>();
    IntPtr module = LoadLibraryExW(path, IntPtr.Zero, 2 | 32);
    Check(module != IntPtr.Zero, "Read executable resources");
    try {
      EnumLanguage callback = delegate(IntPtr image, IntPtr type, IntPtr name, ushort language, IntPtr parameter) {
        languages.Add(language);
        return true;
      };
      bool found = EnumResourceLanguagesW(module, new IntPtr(16), new IntPtr(1), callback, IntPtr.Zero);
      int error = Marshal.GetLastWin32Error();
      if (!found && error != 1812 && error != 1813 && error != 1814 && error != 1815) throw new Win32Exception(error, "Read version resource languages");
    } finally { FreeLibrary(module); }
    IntPtr update = BeginUpdateResourceW(path, false);
    Check(update != IntPtr.Zero, "Begin version resource update");
    bool committed = false;
    try {
      foreach (ushort language in languages) {
        Check(UpdateResourceW(update, new IntPtr(16), new IntPtr(1), language, null, 0), "Remove old version metadata");
      }
      Check(UpdateResourceW(update, new IntPtr(16), new IntPtr(1), 0x0409, resource, (uint)resource.Length), "Write Validex version metadata");
      Check(EndUpdateResourceW(update, false), "Commit Validex version metadata");
      committed = true;
    } finally { if (!committed) EndUpdateResourceW(update, true); }
  }
}
'@

[ValidexVersionResources]::Replace($Executable, [IO.File]::ReadAllBytes($VersionResource))
$expected = Get-Content -LiteralPath $Metadata -Raw | ConvertFrom-Json
$actual = [Diagnostics.FileVersionInfo]::GetVersionInfo([IO.Path]::GetFullPath($Executable))
foreach ($name in @("ProductName", "FileDescription", "InternalName", "OriginalFilename", "FileVersion", "ProductVersion")) {
  if ($actual.$name -ne $expected.$name) { throw "Executable metadata mismatch for ${name}: $($actual.$name)" }
}
Write-Output "Branded $($actual.OriginalFilename): $($actual.ProductName) $($actual.FileVersion) ($($actual.InternalName)); unsigned product metadata"
