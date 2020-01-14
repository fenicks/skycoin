import { switchMap } from 'rxjs/operators';
import { Component, OnInit, OnDestroy, Input, Output, EventEmitter } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { SubscriptionLike, Subject, of } from 'rxjs';
import { ApiService } from '../../../../../services/api.service';
import { MatDialog } from '@angular/material/dialog';
import { SeedWordDialogComponent } from '../../../../layout/seed-word-dialog/seed-word-dialog.component';
import { MsgBarService } from '../../../../../services/msg-bar.service';
import { ConfirmationParams, ConfirmationComponent } from '../../../../layout/confirmation/confirmation.component';

export class WalletFormData {
  creatingNewWallet: boolean;
  label: string;
  seed: string;
  password: string;
  enterSeedWithAssistance: boolean;
  lastAssistedSeed: string;
  lastCustomSeed: string;
  numberOfWords: number;
}

@Component({
  selector: 'app-create-wallet-form',
  templateUrl: './create-wallet-form.component.html',
  styleUrls: ['./create-wallet-form.component.scss'],
})
export class CreateWalletFormComponent implements OnInit, OnDestroy {
  @Input() create: boolean;
  @Input() onboarding: boolean;
  @Input() busy = false;
  @Output() createRequested = new EventEmitter<void>();

  form: FormGroup;
  customSeedIsNormal = true;
  customSeedAccepted = false;
  encrypt = true;
  enterSeedWithAssistance = true;
  assistedSeedConfirmed = false;
  lastAssistedSeed = '';
  numberOfAutogeneratedWords = 0;

  private seed: Subject<string> = new Subject<string>();
  private statusSubscription: SubscriptionLike;
  private seedValiditySubscription: SubscriptionLike;

  private partialSeed: string[];

  constructor(
    private apiService: ApiService,
    private dialog: MatDialog,
    private msgBarService: MsgBarService,
  ) { }

  ngOnInit() {
    if (!this.onboarding) {
      this.initForm();
    } else {
      this.initForm(false, null);
    }
  }

  ngOnDestroy() {
    this.msgBarService.hide();
    this.statusSubscription.unsubscribe();
    this.seedValiditySubscription.unsubscribe();
  }

  get isValid(): boolean {
    return this.form.valid &&
      (
        (!this.enterSeedWithAssistance && (this.customSeedIsNormal || this.customSeedAccepted)) ||
        (this.create && this.enterSeedWithAssistance && this.assistedSeedConfirmed) ||
        (!this.create && this.enterSeedWithAssistance && this.lastAssistedSeed.length > 2)
      );
  }

  onCustomSeedAcceptance(event) {
    this.customSeedAccepted = event.checked;
  }

  setEncrypt(event) {
    this.encrypt = event.checked;
    this.form.updateValueAndValidity();
  }

  getData(): WalletFormData {
    return {
      creatingNewWallet: this.create,
      label: this.form.value.label,
      seed: this.enterSeedWithAssistance ? this.lastAssistedSeed : this.form.value.seed,
      password: !this.onboarding && this.encrypt ? this.form.value.password : null,
      enterSeedWithAssistance: this.enterSeedWithAssistance,
      lastAssistedSeed: this.lastAssistedSeed,
      lastCustomSeed: this.form.value.seed,
      numberOfWords: !this.create ? this.form.value.number_of_words : this.numberOfAutogeneratedWords,
    };
  }

  changeSeedType() {
    this.msgBarService.hide();

    if (!this.enterSeedWithAssistance) {
      this.enterSeedWithAssistance = true;
      this.removeConfirmations();
    } else {
      const confirmationParams: ConfirmationParams = {
        text: this.create ? 'wallet.new.seed.custom-seed-warning-text' : 'wallet.new.seed.custom-seed-warning-text-recovering',
        headerText: 'wallet.new.seed.custom-seed-warning-title',
        checkboxText: this.create ? 'wallet.new.seed.custom-seed-warning-check' : null,
        confirmButtonText: 'wallet.new.seed.custom-seed-warning-continue',
        cancelButtonText: 'wallet.new.seed.custom-seed-warning-cancel',
      };

      ConfirmationComponent.openDialog(this.dialog, confirmationParams).afterClosed().subscribe(confirmationResult => {
        if (confirmationResult) {
          this.enterSeedWithAssistance = false;
          this.removeConfirmations();
        }
      });
    }
  }

  enterSeed() {
    if (!this.create) {
      this.partialSeed = [];
      this.askForWord(0);
      this.msgBarService.hide();
    }
  }

  confirmNormalSeed() {
    if (!this.assistedSeedConfirmed) {
      this.partialSeed = [];
      this.askForWord(0);
      this.msgBarService.hide();
    }
  }

  private askForWord(wordIndex: number) {
    return SeedWordDialogComponent.openDialog(this.dialog, {
      isForHwWallet: false,
      wordNumber: wordIndex + 1,
      restoringSoftwareWallet: !this.create,
    }).afterClosed().subscribe(word => {
      if (word) {
        if (this.create) {
          const lastSeedWords = this.lastAssistedSeed.split(' ');
          if (word !== lastSeedWords[wordIndex]) {
            this.msgBarService.showError('wallet.new.seed.incorrect-word');

            return;
          }
        }

        this.partialSeed[wordIndex] = word;
        wordIndex += 1;

        if ((this.create && wordIndex < this.numberOfAutogeneratedWords) || (!this.create && wordIndex < this.form.controls['number_of_words'].value)) {
          this.askForWord(wordIndex);
        } else {
          if (this.create) {
            this.assistedSeedConfirmed = true;
          } else {
            let enteredSeed = '';
            this.partialSeed.forEach(currentWord => enteredSeed += currentWord + ' ');
            enteredSeed = enteredSeed.substr(0, enteredSeed.length - 1);

            this.apiService.post('wallet/seed/verify', {seed: enteredSeed}, {}, true)
              .subscribe(() => this.lastAssistedSeed = enteredSeed, () => this.msgBarService.showError('wallet.new.seed.invalid-seed'));
          }
        }
      }
    });
  }

  initForm(create: boolean = null, data: WalletFormData = null) {
    this.msgBarService.hide();

    create = create !== null ? create : this.create;

    this.lastAssistedSeed = '';
    this.enterSeedWithAssistance = true;

    const validators = [];
    if (create) {
      validators.push(this.seedMatchValidator.bind(this));
    }
    if (!this.onboarding) {
      validators.push(this.validatePasswords.bind(this));
    }
    validators.push(this.mustHaveSeed.bind(this));

    this.form = new FormGroup({}, validators);
    this.form.addControl('label', new FormControl(data ? data.label : '', [Validators.required]));
    this.form.addControl('seed', new FormControl(data ? data.lastCustomSeed : ''));
    this.form.addControl('confirm_seed', new FormControl(data ? data.lastCustomSeed : ''));
    this.form.addControl('password', new FormControl());
    this.form.addControl('confirm_password', new FormControl());
    this.form.addControl('number_of_words', new FormControl(!this.create && data && data.numberOfWords ? data.numberOfWords : 12));

    this.removeConfirmations(false);

    if (create && !data) {
      this.generateSeed(128);
    }

    if (data) {
      setTimeout(() => { this.seed.next(data['seed']); });
      this.customSeedAccepted = true;
      this.enterSeedWithAssistance = data.enterSeedWithAssistance;
      this.lastAssistedSeed = data.lastAssistedSeed;
      this.assistedSeedConfirmed = true;

      if (this.create) {
        this.numberOfAutogeneratedWords = data.numberOfWords;
      }
    }

    if (this.statusSubscription && !this.statusSubscription.closed) {
      this.statusSubscription.unsubscribe();
    }
    this.statusSubscription = this.form.statusChanges.subscribe(() => {
      this.customSeedAccepted = false;
      this.seed.next(this.form.get('seed').value);
    });

    this.subscribeToSeedValidation();
  }

  generateSeed(entropy: number) {
    if (entropy === 128) {
      this.numberOfAutogeneratedWords = 12;
    } else {
      this.numberOfAutogeneratedWords = 24;
    }

    this.apiService.generateSeed(entropy).subscribe(seed => {
      this.lastAssistedSeed = seed;
      this.form.get('seed').setValue(seed);
      this.removeConfirmations();
    });
  }

  requestCreation() {
    this.createRequested.emit();
  }

  private removeConfirmations(cleanSecondSeedField = true) {
    this.customSeedAccepted = false;
    this.assistedSeedConfirmed = false;
    if (cleanSecondSeedField) {
      this.form.get('confirm_seed').setValue('');
    }
    this.form.updateValueAndValidity();
  }

  private subscribeToSeedValidation() {
    if (this.seedValiditySubscription) {
      this.seedValiditySubscription.unsubscribe();
    }

    this.seedValiditySubscription = this.seed.asObservable().pipe(switchMap(seed => {
      if ((!this.seedMatchValidator() || !this.create) && !this.enterSeedWithAssistance) {
        return this.apiService.post('wallet/seed/verify', {seed}, {}, true);
      } else {
        return of(0);
      }
    })).subscribe(() => {
      this.customSeedIsNormal = true;
    }, error => {
      if (error.status && error.status === 422) {
        this.customSeedIsNormal = false;
      } else {
        this.customSeedIsNormal = true;
      }
      this.subscribeToSeedValidation();
    });
  }

  private validatePasswords() {
    if (this.encrypt && this.form && this.form.get('password') && this.form.get('confirm_password')) {
      if (this.form.get('password').value) {
        if (this.form.get('password').value !== this.form.get('confirm_password').value) {
          return { NotEqual: true };
        }
      } else {
        return { Required: true };
      }
    }

    return null;
  }

  private mustHaveSeed() {
    if (!this.enterSeedWithAssistance) {
      if ((this.form.get('seed').value as string) === '') {
        return { Required: true };
      } else {
        return null;
      }
    }
  }

  private seedMatchValidator() {
    if (this.enterSeedWithAssistance) {
      return null;
    }

    if (this.form && this.form.get('seed') && this.form.get('confirm_seed')) {
      return this.form.get('seed').value === this.form.get('confirm_seed').value ? null : { NotEqual: true };
    } else {
      this.customSeedIsNormal = true;

      return { NotEqual: true };
    }
  }
}
