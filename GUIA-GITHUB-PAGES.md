# Como publicar o Rodela Track no GitHub Pages

Guia do zero. Leva uns 10 minutos.

## O que é o GitHub Pages

É um serviço gratuito do GitHub que transforma um repositório com arquivos HTML/CSS/JS em um site.

- Você sobe os arquivos para o repositório.
- O GitHub publica tudo em `https://SEU-USUARIO.github.io/rodela-track/`.
- A cada `push`, o site é atualizado em 1–2 minutos.

> **Privacidade:** no plano gratuito, o repositório precisa ser **público**. Isso deixa o **código** visível para qualquer pessoa. Os seus **dados** (treinos, dieta) não vão para lá: eles ficam salvos só no iPhone.

---

## 1. Criar a conta

1. Acesse <https://github.com/signup> e crie a conta.
2. Anote o **nome de usuário**, porque ele vira parte do endereço do app.

## 2. Criar o repositório

1. Clique em **+** (canto superior direito) → **New repository**.
2. Preencha:
   - **Repository name:** `rodela-track`
   - **Public**
   - Deixe "Add a README" **desmarcado**, porque o projeto já tem um.
3. Clique em **Create repository**.

## 3. Subir os arquivos

### Opção A: pelo terminal (recomendado)

Os arquivos já estão em `~/Documents/rodela-track`.

```bash
cd ~/Documents/rodela-track
git init
git add .
git commit -m "Rodela Track v0.1.0 - módulo Treino"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/rodela-track.git
git push -u origin main
```

**Autenticação:** o GitHub não aceita a senha da conta no `git push`. Use uma destas formas:

- **GitHub CLI (mais fácil):** `sudo apt install gh` → `gh auth login` → escolha *GitHub.com → HTTPS → Login with a web browser*. Depois disso, o `git push` funciona direto.
- **Token:** GitHub → *Settings → Developer settings → Personal access tokens → Fine-grained tokens* → crie um token com permissão *Contents: Read and write* no repositório. Quando o `git push` pedir senha, cole o token no lugar dela.

### Opção B: pelo navegador

1. Na página do repositório vazio, clique em **uploading an existing file**.
2. Arraste **todo o conteúdo** da pasta `rodela-track` (as pastas `css`, `js` e `icons` e os arquivos soltos). O `index.html` precisa ficar na raiz do repositório.
3. Clique em **Commit changes**.

## 4. Ativar o GitHub Pages

1. No repositório: **Settings** → **Pages** (menu lateral).
2. Em **Build and deployment**:
   - **Source:** *Deploy from a branch*
   - **Branch:** `main` e pasta `/ (root)` → **Save**
3. Espere 1–2 minutos e recarregue a página. Vai aparecer: *"Your site is live at `https://SEU-USUARIO.github.io/rodela-track/`"*.

O andamento da publicação aparece na aba **Actions** (job "pages build and deployment").

## 5. Instalar no iPhone

1. Abra o endereço no **Safari**. Precisa ser o Safari, não o Chrome.
2. Toque em **Compartilhar** (quadrado com a seta) → **Adicionar à Tela de Início** → **Adicionar**.
3. Daqui para frente, abra **sempre pelo ícone** da tela de início.

> ⚠️ O Safari e o app instalado guardam os dados **separadamente**. Os treinos que você registrar no Safari não aparecem no app instalado, e vice-versa.

Depois de aberto uma vez, o app funciona **offline**.

---

## 6. Publicar atualizações

Quando eu te mandar uma versão nova (ou quando você mexer no código):

1. Substitua os arquivos na pasta.
2. Em `sw.js`, aumente a `VERSION` (ex.: `0.1.0` → `0.2.0`). **Sem isso, o iPhone continua usando a versão antiga que está em cache.**
3. Publique:
   ```bash
   git add .
   git commit -m "v0.2.0"
   git push
   ```
4. No iPhone, abra o app. Em alguns segundos aparece a faixa **"Nova versão disponível → Atualizar"**. Toque nela. Os dados são mantidos.

## 7. Testar no PC antes de publicar (opcional)

```bash
cd ~/Documents/rodela-track
python3 -m http.server 8000
```

Abra <http://localhost:8000> no navegador. O DevTools em modo celular (Ctrl+Shift+M) simula o iPhone.

## 8. Backup

- Os dados ficam só no iPhone, no IndexedDB do app.
- Em **Ajustes → Backup → Exportar**, salve o arquivo `.json` no app Arquivos/iCloud.
- Faça isso de vez em quando. O app avisa quando o último backup tem mais de 14 dias.
- Se você apagar o app da tela de início, os dados são apagados junto. Exporte um backup antes.
