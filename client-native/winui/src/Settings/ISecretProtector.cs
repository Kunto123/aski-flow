namespace Aski.NativeClient.Settings;

public interface ISecretProtector
{
    string Protect(string plainText);

    string Unprotect(string cipherText);
}
