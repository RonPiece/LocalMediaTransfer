using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace LocalMediaTransfer.GUI.Services
{
    internal static class ServerControlCredentialStore
    {
        private const int CredentialSize = 32;
        private const uint CryptProtectUiForbidden = 0x1;
        private static readonly object SyncRoot = new();

        public static byte[] LoadOrCreate(
            string securityDirectory,
            string environmentName)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(securityDirectory);
            ArgumentException.ThrowIfNullOrWhiteSpace(environmentName);
            if (!OperatingSystem.IsWindows())
            {
                throw new PlatformNotSupportedException(
                    "Server ownership credentials require Windows DPAPI.");
            }

            lock (SyncRoot)
            {
                Directory.CreateDirectory(securityDirectory);
                string path = Path.Combine(securityDirectory, "server-control-key.dpapi");
                if (File.Exists(path))
                {
                    return Load(path, environmentName);
                }

                byte[] credential = RandomNumberGenerator.GetBytes(CredentialSize);
                byte[] protectedCredential = Protect(credential, environmentName);
                string temporaryPath = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
                try
                {
                    File.WriteAllBytes(temporaryPath, protectedCredential);
                    try
                    {
                        File.Move(temporaryPath, path);
                        return credential;
                    }
                    catch (IOException) when (File.Exists(path))
                    {
                        CryptographicOperations.ZeroMemory(credential);
                        return Load(path, environmentName);
                    }
                }
                finally
                {
                    CryptographicOperations.ZeroMemory(protectedCredential);
                    try
                    {
                        if (File.Exists(temporaryPath)) File.Delete(temporaryPath);
                    }
                    catch
                    {
                    }
                }
            }
        }

        private static byte[] Load(string path, string environmentName)
        {
            byte[] protectedCredential = File.ReadAllBytes(path);
            try
            {
                byte[] credential = Unprotect(protectedCredential, environmentName);
                if (credential.Length != CredentialSize)
                {
                    CryptographicOperations.ZeroMemory(credential);
                    throw new CryptographicException(
                        "The server ownership credential has an invalid length.");
                }
                return credential;
            }
            finally
            {
                CryptographicOperations.ZeroMemory(protectedCredential);
            }
        }

        private static byte[] Protect(byte[] plaintext, string environmentName) =>
            Transform(plaintext, environmentName, protect: true);

        private static byte[] Unprotect(byte[] ciphertext, string environmentName) =>
            Transform(ciphertext, environmentName, protect: false);

        private static byte[] Transform(
            byte[] input,
            string environmentName,
            bool protect)
        {
            byte[] entropy = Encoding.UTF8.GetBytes(
                "LocalMediaTransfer.ServerOwnership.v1|" + environmentName);
            DataBlob inputBlob = default;
            DataBlob entropyBlob = default;
            DataBlob outputBlob = default;
            try
            {
                inputBlob = DataBlob.FromBytes(input);
                entropyBlob = DataBlob.FromBytes(entropy);
                bool success = protect
                    ? CryptProtectData(
                        ref inputBlob,
                        "Local Media Transfer server ownership",
                        ref entropyBlob,
                        IntPtr.Zero,
                        IntPtr.Zero,
                        CryptProtectUiForbidden,
                        out outputBlob)
                    : CryptUnprotectData(
                        ref inputBlob,
                        IntPtr.Zero,
                        ref entropyBlob,
                        IntPtr.Zero,
                        IntPtr.Zero,
                        CryptProtectUiForbidden,
                        out outputBlob);
                if (!success)
                {
                    throw new Win32Exception(
                        Marshal.GetLastWin32Error(),
                        protect
                            ? "Windows could not protect the server ownership credential."
                            : "Windows could not unprotect the server ownership credential.");
                }

                var result = new byte[outputBlob.Length];
                Marshal.Copy(outputBlob.Data, result, 0, outputBlob.Length);
                return result;
            }
            finally
            {
                inputBlob.Free();
                entropyBlob.Free();
                if (outputBlob.Data != IntPtr.Zero) LocalFree(outputBlob.Data);
                CryptographicOperations.ZeroMemory(entropy);
            }
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct DataBlob
        {
            public int Length;
            public IntPtr Data;

            public static DataBlob FromBytes(byte[] bytes)
            {
                var blob = new DataBlob
                {
                    Length = bytes.Length,
                    Data = Marshal.AllocHGlobal(bytes.Length)
                };
                Marshal.Copy(bytes, 0, blob.Data, bytes.Length);
                return blob;
            }

            public void Free()
            {
                if (Data == IntPtr.Zero) return;
                Marshal.Copy(new byte[Length], 0, Data, Length);
                Marshal.FreeHGlobal(Data);
                Data = IntPtr.Zero;
                Length = 0;
            }
        }

        [DllImport("crypt32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CryptProtectData(
            ref DataBlob dataIn,
            string description,
            ref DataBlob optionalEntropy,
            IntPtr reserved,
            IntPtr prompt,
            uint flags,
            out DataBlob dataOut);

        [DllImport("crypt32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CryptUnprotectData(
            ref DataBlob dataIn,
            IntPtr description,
            ref DataBlob optionalEntropy,
            IntPtr reserved,
            IntPtr prompt,
            uint flags,
            out DataBlob dataOut);

        [DllImport("kernel32.dll")]
        private static extern IntPtr LocalFree(IntPtr memory);
    }
}
