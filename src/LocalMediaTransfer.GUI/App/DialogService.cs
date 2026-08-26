using System;
using System.Threading.Tasks;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace LocalMediaTransfer.GUI.AppServices
{
    public static class DialogService
    {
        public static async Task<bool> ConfirmAsync(
            XamlRoot xamlRoot,
            string title,
            string content,
            string primaryButtonText,
            string closeButtonText,
            ContentDialogButton defaultButton = ContentDialogButton.Close)
        {
            var dialog = new ContentDialog
            {
                XamlRoot = xamlRoot,
                Title = title,
                Content = content,
                PrimaryButtonText = primaryButtonText,
                CloseButtonText = closeButtonText,
                DefaultButton = defaultButton
            };

            return await dialog.ShowAsync() == ContentDialogResult.Primary;
        }

        public static async Task ShowMessageAsync(
            XamlRoot xamlRoot,
            string title,
            string content,
            string closeButtonText = "OK")
        {
            var dialog = new ContentDialog
            {
                XamlRoot = xamlRoot,
                Title = title,
                Content = content,
                CloseButtonText = closeButtonText,
                DefaultButton = ContentDialogButton.Close
            };

            await dialog.ShowAsync();
        }
    }
}
