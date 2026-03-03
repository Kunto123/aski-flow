namespace Aski.NativeClient.Settings;

public sealed class PlainTextSecretProtector : ISecretProtector
{
    public string Protect(string plainText) => plainText ?? string.Empty;

    public string Unprotect(string cipherText) => cipherText ?? string.Empty;
}
