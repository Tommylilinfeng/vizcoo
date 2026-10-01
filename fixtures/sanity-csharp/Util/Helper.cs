namespace MyApp.Util;

public class Helper
{
    private readonly string _s;
    public Helper(string s) { _s = s; }
    public string Shout() => _s.ToUpper();
}
