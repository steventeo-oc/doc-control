package com.doccontrol.auth;

import com.doccontrol.auth.dto.LoginRequest;
import com.doccontrol.auth.dto.UserSummaryDto;
import com.doccontrol.security.AppUserPrincipal;
import com.doccontrol.security.CurrentUserProvider;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/auth")
public class AuthController {

    private final AuthenticationManager authenticationManager;
    private final CurrentUserProvider currentUserProvider;
    private final SecurityContextRepository securityContextRepository = new HttpSessionSecurityContextRepository();

    public AuthController(AuthenticationManager authenticationManager, CurrentUserProvider currentUserProvider) {
        this.authenticationManager = authenticationManager;
        this.currentUserProvider = currentUserProvider;
    }

    /**
     * Local login. Authentication itself is delegated to the
     * AuthenticationManager, so a future LDAP/AD provider slots in behind
     * this endpoint without changes here (CLAUDE.md auth decision).
     */
    @PostMapping("/login")
    @Transactional(readOnly = true)
    UserSummaryDto login(@Valid @RequestBody LoginRequest request,
                         HttpServletRequest httpRequest, HttpServletResponse httpResponse) {
        Authentication authentication = authenticationManager.authenticate(
                new UsernamePasswordAuthenticationToken(request.email(), request.password()));

        SecurityContext context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(authentication);
        SecurityContextHolder.setContext(context);
        securityContextRepository.saveContext(context, httpRequest, httpResponse);

        return UserSummaryDto.from(currentUserProvider.getCurrentUser());
    }

    @GetMapping("/me")
    @Transactional(readOnly = true)
    UserSummaryDto me() {
        return UserSummaryDto.from(currentUserProvider.getCurrentUser());
    }
}
